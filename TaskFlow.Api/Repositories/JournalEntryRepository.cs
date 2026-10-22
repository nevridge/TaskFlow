using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class JournalEntryRepository(TaskDbContext context) : IJournalEntryRepository
{
    private const int SqliteConstraintErrorCode = 19;
    private const int SqliteUniqueConstraintErrorCode = 2067;
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<JournalEntry>> GetAllAsync() =>
        // Read-only query: AsNoTracking prevents identity map collisions on ChildTaskItems
        // when both a parent and its child are linked to the same JournalEntry.
        await _context.JournalEntries
            .AsNoTracking()
            .Include(e => e.Todos)
                .ThenInclude(t => t.ChildTaskItems)
                    .ThenInclude(c => c.CurrentJournalEntry)
            .Include(e => e.LogEntries).ThenInclude(l => l.TaskItem)
            .OrderByDescending(e => e.Date)
            .ToListAsync();

    public async Task<JournalEntry?> GetByIdAsync(int id) =>
        // Read-only query: AsNoTracking prevents identity map collisions on ChildTaskItems
        // when both a parent and its child are linked to the same JournalEntry.
        await _context.JournalEntries
            .AsNoTracking()
            .Include(e => e.Todos)
                .ThenInclude(t => t.ChildTaskItems)
                    .ThenInclude(c => c.CurrentJournalEntry)
            .Include(e => e.LogEntries).ThenInclude(l => l.TaskItem)
            .FirstOrDefaultAsync(e => e.Id == id);

    public async Task<JournalEntry?> GetByDateAsync(DateOnly date) =>
        // Read-only query: AsNoTracking prevents identity map collisions on ChildTaskItems
        // when both a parent and its child are linked to the same JournalEntry.
        await _context.JournalEntries
            .AsNoTracking()
            .Include(e => e.Todos)
                .ThenInclude(t => t.ChildTaskItems)
                    .ThenInclude(c => c.CurrentJournalEntry)
            .Include(e => e.LogEntries).ThenInclude(l => l.TaskItem)
            .FirstOrDefaultAsync(e => e.Date == date);

    public async Task<JournalEntry> AddAsync(JournalEntry entry)
    {
        entry.CreatedAt = DateTime.UtcNow;
        _context.JournalEntries.Add(entry);
        try
        {
            await _context.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
        {
            throw new DuplicateJournalDateException(entry.Date);
        }

        return entry;
    }

    public async Task<IReadOnlyList<int>> CarryForwardIncompleteTasksAsync(int entryId, DateOnly userToday)
    {
        var target = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        if (target is null || target.Date != userToday)
        {
            return [];
        }

        var sources = await _context.JournalEntries
            .Include(e => e.Todos)
            .Where(e => e.Date < userToday && e.Id != entryId
                && e.Todos.Any(t => t.CurrentJournalEntryId == e.Id && t.Status != Status.Completed))
            .OrderBy(e => e.Date)
            .ToListAsync();

        var movedIds = new List<int>();
        foreach (var source in sources)
        {
            var tasksToMove = source.Todos
                .Where(t => t.CurrentJournalEntryId == source.Id && t.Status != Status.Completed)
                .OrderBy(t => t.Id)
                .ToList();

            foreach (var task in tasksToMove)
            {
                source.Todos.Remove(task);
                target.Todos.Add(task);
                task.CurrentJournalEntryId = target.Id;
                task.FirstTaggedDate ??= source.Date;
                task.MoveCount += 1;
                _context.TaskItemEvents.Add(new TaskItemEvent
                {
                    TaskItemId = task.Id,
                    EventType = "ReassignedToJournalDay",
                    OccurredAtUtc = DateTime.UtcNow,
                    FromJournalEntryId = source.Id,
                    ToJournalEntryId = target.Id,
                    FromJournalDate = source.Date,
                    ToJournalDate = target.Date,
                    ChangeSummary = "Automatically moved forward to the next journal day."
                });
                movedIds.Add(task.Id);
            }
        }

        if (movedIds.Count == 0)
        {
            return [];
        }

        try
        {
            await _context.SaveChangesAsync();
            return movedIds;
        }
        catch (DbUpdateException)
        {
            // Race condition: another request already carried these tasks forward; the whole save rolled back.
            return [];
        }
    }

    public async Task UpdateAsync(JournalEntry entry)
    {
        // The entry usually arrives as the detached graph from GetByIdAsync (todos, their subtasks and log
        // entries included). Re-attaching that graph with Update() re-inserts the todo join rows (UNIQUE
        // constraint failure) and rewrites every loaded task and log row, so copy only the entry's own
        // editable fields onto the tracked row instead. Date and CreatedAt are never changed here.
        var tracked = await _context.JournalEntries.FindAsync(entry.Id)
            ?? throw new KeyNotFoundException($"Journal entry {entry.Id} was not found.");

        var now = DateTime.UtcNow;
        tracked.Title = entry.Title;
        tracked.Summary = entry.Summary;
        tracked.UpdatedAt = now;
        entry.UpdatedAt = now;

        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var entry = await _context.JournalEntries.FindAsync(id);
        if (entry is null)
        {
            return;
        }

        _context.JournalEntries.Remove(entry);
        await _context.SaveChangesAsync();
    }

    public async Task<IEnumerable<TaskItem>> GetTodosAsync(int entryId)
    {
        // Read-only query: AsNoTracking prevents identity map collisions on ChildTaskItems
        // when both a parent and its child are linked to the same JournalEntry.
        var entry = await _context.JournalEntries
            .AsNoTracking()
            .Include(e => e.Todos)
                .ThenInclude(t => t.ChildTaskItems)
                    .ThenInclude(c => c.CurrentJournalEntry)
            .Include(e => e.Todos).ThenInclude(t => t.Project)
            .Include(e => e.Todos).ThenInclude(t => t.ChildTaskItems).ThenInclude(c => c.Project)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        return entry?.Todos.Where(t => t.CurrentJournalEntryId == entryId) ?? [];
    }

    public async Task<bool> TodoExistsAsync(int entryId, int taskItemId)
    {
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        return entry?.Todos.Any(t => t.Id == taskItemId && t.CurrentJournalEntryId == entryId) ?? false;
    }

    public async Task<AddTodoResult> AddTodoAsync(int entryId, int taskItemId, int? timezoneOffsetMinutes = null)
    {
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        if (entry is null)
        {
            return AddTodoResult.EntryNotFound;
        }

        var task = await _context.TaskItems.FindAsync(taskItemId);
        if (task is null)
        {
            return AddTodoResult.TaskNotFound;
        }

        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, timezoneOffsetMinutes);
        if (entry.Date < today)
        {
            return AddTodoResult.PastDayNotAllowed;
        }

        if (entry.Todos.Any(t => t.Id == taskItemId))
        {
            return AddTodoResult.AlreadyLinked;
        }

        var previousEntryId = task.CurrentJournalEntryId;
        DateOnly? previousEntryDate = null;
        if (previousEntryId.HasValue && previousEntryId.Value != entryId)
        {
            var previousEntry = await _context.JournalEntries
                .Include(e => e.Todos)
                .FirstOrDefaultAsync(e => e.Id == previousEntryId.Value);
            if (previousEntry is not null)
            {
                previousEntryDate = previousEntry.Date;
                var existingLink = previousEntry.Todos.FirstOrDefault(t => t.Id == taskItemId);
                if (existingLink is not null)
                {
                    previousEntry.Todos.Remove(existingLink);
                }
            }

            task.MoveCount += 1;
        }

        task.CurrentJournalEntryId = entryId;
        task.FirstTaggedDate ??= entry.Date;

        entry.Todos.Add(task);
        _context.TaskItemEvents.Add(new TaskItemEvent
        {
            TaskItemId = task.Id,
            EventType = previousEntryId.HasValue && previousEntryId.Value != entryId ? "ReassignedToJournalDay" : "AssignedToJournalDay",
            OccurredAtUtc = DateTime.UtcNow,
            FromJournalEntryId = previousEntryId,
            ToJournalEntryId = entryId,
            FromJournalDate = previousEntryDate,
            ToJournalDate = entry.Date,
            ChangeSummary = previousEntryId.HasValue && previousEntryId.Value != entryId
                ? "Task was moved to a different journal day."
                : "Task was assigned to a journal day."
        });
        try
        {
            await _context.SaveChangesAsync();
            return AddTodoResult.Success;
        }
        catch (DbUpdateException)
        {
            // Race condition: another request linked the same task between our check and save.
            return AddTodoResult.AlreadyLinked;
        }
    }

    public async Task<bool> RemoveTodoAsync(int entryId, int taskItemId)
    {
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        if (entry is null)
        {
            return false;
        }

        var task = entry.Todos.FirstOrDefault(t => t.Id == taskItemId);
        if (task is null)
        {
            return false;
        }

        entry.Todos.Remove(task);
        if (task.CurrentJournalEntryId == entryId)
        {
            task.CurrentJournalEntryId = null;
        }
        _context.TaskItemEvents.Add(new TaskItemEvent
        {
            TaskItemId = task.Id,
            EventType = "RemovedFromJournalDay",
            OccurredAtUtc = DateTime.UtcNow,
            FromJournalEntryId = entryId,
            FromJournalDate = entry.Date,
            ChangeSummary = "Task was removed from the journal day."
        });
        await _context.SaveChangesAsync();
        return true;
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException ex) =>
        (ex.InnerException is SqliteException sqliteEx
            && sqliteEx.SqliteErrorCode == SqliteConstraintErrorCode
            && sqliteEx.SqliteExtendedErrorCode == SqliteUniqueConstraintErrorCode)
        || ex.InnerException?.Message.Contains("JournalEntries.Date", StringComparison.OrdinalIgnoreCase) == true;
}
