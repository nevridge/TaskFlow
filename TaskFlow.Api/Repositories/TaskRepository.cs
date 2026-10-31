using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class TaskRepository(TaskDbContext context) : ITaskRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IRepositoryTransaction> BeginTransactionAsync() =>
        new RepositoryTransaction(await _context.Database.BeginTransactionAsync());

    private sealed class RepositoryTransaction(IDbContextTransaction transaction) : IRepositoryTransaction
    {
        public Task CommitAsync(CancellationToken cancellationToken = default) =>
            transaction.CommitAsync(cancellationToken);

        public ValueTask DisposeAsync() => transaction.DisposeAsync();
    }

    public async Task<IEnumerable<TaskItem>> GetAllAsync() =>
        // Read-only query: AsNoTracking avoids change-tracking overhead; callers must not mutate or Update the result.
        await _context.TaskItems.AsNoTracking().Include(t => t.Project).ToListAsync();

    public async Task<TaskItem?> GetByIdAsync(int id) =>
        await _context.TaskItems.Include(t => t.Project).FirstOrDefaultAsync(t => t.Id == id);

    public async Task<TaskItem?> GetByIdNoTrackingAsync(int id) =>
        // Read-only query: AsNoTracking avoids change-tracking overhead; callers must not mutate or Update the result.
        await _context.TaskItems.AsNoTracking().Include(t => t.Project).FirstOrDefaultAsync(t => t.Id == id);

    public async Task<IEnumerable<TaskItem>> GetChildrenAsync(int parentId) =>
        // Read-only query: AsNoTracking avoids change-tracking overhead; callers must not mutate or Update the result.
        await _context.TaskItems.AsNoTracking().Where(t => t.ParentTaskItemId == parentId).ToListAsync();

    public async Task<DateOnly?> GetAssignedJournalDateAsync(int taskId) =>
        await _context.TaskItems
            .Where(t => t.Id == taskId)
            .Select(t => t.CurrentJournalEntry == null ? (DateOnly?)null : t.CurrentJournalEntry.Date)
            .SingleOrDefaultAsync();

    // The id lists below are intentionally not chunked: GetAll already loads every task, and the counts involved
    // are far below SQLite's 32766 bound-variable limit. Keeping one query preserves the fixed-query-count goal.
    public async Task<IReadOnlyDictionary<int, DateOnly>> GetAssignedJournalDatesAsync(IReadOnlyCollection<int> taskIds)
    {
        if (taskIds.Count == 0)
        {
            return new Dictionary<int, DateOnly>();
        }

        var rows = await _context.TaskItems
            .Where(t => taskIds.Contains(t.Id) && t.CurrentJournalEntryId != null)
            .Select(t => new { t.Id, t.CurrentJournalEntry!.Date })
            .ToListAsync();

        return rows.ToDictionary(r => r.Id, r => r.Date);
    }

    public async Task<IReadOnlyDictionary<int, DateOnly>> GetLastMovedDatesAsync(IReadOnlyCollection<int> taskIds)
    {
        if (taskIds.Count == 0)
        {
            return new Dictionary<int, DateOnly>();
        }

        var rows = await _context.TaskItemEvents
            .Where(e => taskIds.Contains(e.TaskItemId) && (e.ToJournalDate != null || e.FromJournalDate != null))
            .Select(e => new { e.Id, e.TaskItemId, e.OccurredAtUtc, e.FromJournalDate, e.ToJournalDate })
            .ToListAsync();

        var result = new Dictionary<int, DateOnly>();
        foreach (var group in rows.GroupBy(r => r.TaskItemId))
        {
            var date = LastMovedDateResolver.Resolve(
                group.Select(r => new MoveEventProjection(r.Id, r.OccurredAtUtc, r.FromJournalDate, r.ToJournalDate)));
            if (date.HasValue)
            {
                result[group.Key] = date.Value;
            }
        }

        return result;
    }

    public async Task<IEnumerable<TaskItemEvent>> GetHistoryAsync(int taskId) =>
        await _context.TaskItemEvents
            .AsNoTracking()
            .Where(e => e.TaskItemId == taskId)
            .OrderBy(e => e.OccurredAtUtc)
            .ToListAsync();

    public async Task<TaskItem> AddAsync(TaskItem task)
    {
        _context.TaskItems.Add(task);
        _context.TaskItemEvents.Add(new TaskItemEvent
        {
            TaskItem = task,
            EventType = "TaskCreated",
            OccurredAtUtc = DateTime.UtcNow,
            ChangeSummary = "Task was created."
        });
        await _context.SaveChangesAsync();
        return task;
    }

    public async Task UpdateAsync(TaskItem task)
    {
        var entry = _context.Entry(task);
        TaskItem? persisted = null;
        // Safety net for callers that pass an untracked (Detached) entity. Production callers in
        // TaskItemsController pass tracked entities, so the API does not reach this branch today, but it is
        // covered by the Detached-entity tests in TaskRepositoryTests and TaskRepositoryUpdateEventTests. Do not remove.
        if (entry.State == EntityState.Detached)
        {
            persisted = await _context.TaskItems
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == task.Id);

            _context.TaskItems.Update(task);
            entry = _context.Entry(task);
        }

        var originalTitle = persisted?.Title ?? entry.OriginalValues.GetValue<string>(nameof(TaskItem.Title));
        // For Description, DueDate and BlockedReason a null stored value is meaningful, so do not fall back to
        // OriginalValues when a persisted row exists.
        var originalDescription = persisted is not null
            ? persisted.Description
            : entry.OriginalValues.GetValue<string?>(nameof(TaskItem.Description));
        var originalPriority = persisted?.Priority ?? entry.OriginalValues.GetValue<Priority>(nameof(TaskItem.Priority));
        var originalStatus = persisted?.Status ?? entry.OriginalValues.GetValue<Status>(nameof(TaskItem.Status));
        var originalDueDate = persisted is not null
            ? persisted.DueDate
            : entry.OriginalValues.GetValue<DateOnly?>(nameof(TaskItem.DueDate));
        var originalBlockedReason = persisted is not null
            ? persisted.BlockedReason
            : entry.OriginalValues.GetValue<string?>(nameof(TaskItem.BlockedReason));

        AddFieldChangedEvent(
            task.Id,
            !string.Equals(originalTitle, task.Title, StringComparison.Ordinal),
            "TitleChanged",
            () => $"Title changed from '{originalTitle}' to '{task.Title}'.");
        AddFieldChangedEvent(
            task.Id,
            originalPriority != task.Priority,
            "PriorityChanged",
            () => $"Priority changed from {originalPriority} to {task.Priority}.");
        AddFieldChangedEvent(
            task.Id,
            !string.Equals(originalDescription, task.Description, StringComparison.Ordinal),
            "DescriptionChanged",
            () => "Description updated.");
        AddFieldChangedEvent(
            task.Id,
            originalDueDate != task.DueDate,
            "DueDateChanged",
            () => $"Due date changed from {FormatDueDate(originalDueDate)} to {FormatDueDate(task.DueDate)}.");

        var wasCompleted = IsCompleted(originalStatus);
        var isCompletedNow = IsCompleted(task.Status);
        var wasBlocked = originalStatus == Status.Blocked;
        var isBlockedNow = task.Status == Status.Blocked;
        if (!wasBlocked && isBlockedNow)
        {
            var reason = NormalizeReason(task.BlockedReason);
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "Blocked",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = reason is null ? "Blocked." : $"Blocked: {reason}."
            });
        }
        else if (wasBlocked && isCompletedNow)
        {
            // Single event: completing a blocked task never also writes an Unblocked event.
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "Completed",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = "Marked complete (was blocked)."
            });
        }
        else if (wasBlocked && !isBlockedNow)
        {
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "Unblocked",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = $"Unblocked, back to {task.Status}."
            });
        }
        else if (wasBlocked && isBlockedNow)
        {
            if (!string.Equals(NormalizeReason(originalBlockedReason), NormalizeReason(task.BlockedReason), StringComparison.Ordinal))
            {
                _context.TaskItemEvents.Add(new TaskItemEvent
                {
                    TaskItemId = task.Id,
                    EventType = "BlockedReasonChanged",
                    OccurredAtUtc = DateTime.UtcNow,
                    ChangeSummary = "Blocked reason updated."
                });
            }
        }
        else if (!wasCompleted && isCompletedNow)
        {
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "Completed",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = "Marked complete."
            });
        }
        else if (wasCompleted && !isCompletedNow)
        {
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "Reopened",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = "Reopened."
            });
        }
        else if (originalStatus != task.Status)
        {
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "StatusChanged",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = $"Status changed from {originalStatus} to {task.Status}."
            });
        }

        _context.TaskItems.Update(task);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var task = await _context.TaskItems.FindAsync(id);
        if (task is null)
        {
            return;
        }

        _context.TaskItems.Remove(task);
        await _context.SaveChangesAsync();
    }

    private static bool IsCompleted(Status status) => status == Status.Completed;

    private static string? NormalizeReason(string? reason)
    {
        var trimmed = reason?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static string FormatDueDate(DateOnly? value) =>
        value?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "none";

    private void AddFieldChangedEvent(int taskId, bool changed, string eventType, Func<string> summary)
    {
        if (!changed)
        {
            return;
        }

        _context.TaskItemEvents.Add(new TaskItemEvent
        {
            TaskItemId = taskId,
            EventType = eventType,
            OccurredAtUtc = DateTime.UtcNow,
            ChangeSummary = summary()
        });
    }
}
