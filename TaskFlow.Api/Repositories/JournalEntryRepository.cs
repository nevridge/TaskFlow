using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class JournalEntryRepository(TaskDbContext context) : IJournalEntryRepository
{
    private const int SqliteConstraintErrorCode = 19;
    private const int SqliteUniqueConstraintErrorCode = 2067;
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<JournalEntry>> GetAllAsync() =>
        await _context.JournalEntries
            .Include(e => e.Todos)
            .Include(e => e.LogEntries)
            .OrderByDescending(e => e.Date)
            .ToListAsync();

    public async Task<JournalEntry?> GetByIdAsync(int id) =>
        await _context.JournalEntries
            .Include(e => e.Todos)
            .Include(e => e.LogEntries)
            .FirstOrDefaultAsync(e => e.Id == id);

    public async Task<JournalEntry?> GetByDateAsync(DateOnly date) =>
        await _context.JournalEntries
            .Include(e => e.Todos)
            .Include(e => e.LogEntries)
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

    public async Task UpdateAsync(JournalEntry entry)
    {
        entry.UpdatedAt = DateTime.UtcNow;
        _context.JournalEntries.Update(entry);
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
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        return entry?.Todos ?? [];
    }

    public async Task<bool> TodoExistsAsync(int entryId, int taskItemId)
    {
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        return entry?.Todos.Any(t => t.Id == taskItemId) ?? false;
    }

    public async Task<AddTodoResult> AddTodoAsync(int entryId, int taskItemId)
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

        if (entry.Todos.Any(t => t.Id == taskItemId))
        {
            return AddTodoResult.AlreadyLinked;
        }

        entry.Todos.Add(task);
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
        await _context.SaveChangesAsync();
        return true;
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException ex) =>
        (ex.InnerException is SqliteException sqliteEx
            && sqliteEx.SqliteErrorCode == SqliteConstraintErrorCode
            && sqliteEx.SqliteExtendedErrorCode == SqliteUniqueConstraintErrorCode)
        || ex.InnerException?.Message.Contains("JournalEntries.Date", StringComparison.OrdinalIgnoreCase) == true;
}
