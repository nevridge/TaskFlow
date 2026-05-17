using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class TaskRepository(TaskDbContext context) : ITaskRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<TaskItem>> GetAllAsync() =>
        await _context.TaskItems.ToListAsync();

    public async Task<TaskItem?> GetByIdAsync(int id) =>
        await _context.TaskItems.FirstOrDefaultAsync(t => t.Id == id);

    public async Task<DateOnly?> GetAssignedJournalDateAsync(int taskId) =>
        await _context.TaskItems
            .Where(t => t.Id == taskId)
            .Select(t => t.CurrentJournalEntry == null ? (DateOnly?)null : t.CurrentJournalEntry.Date)
            .SingleOrDefaultAsync();

    public async Task<IEnumerable<TaskItemEvent>> GetHistoryAsync(int taskId) =>
        await _context.TaskItemEvents
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
        if (entry.State == EntityState.Detached)
        {
            persisted = await _context.TaskItems
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == task.Id);

            _context.TaskItems.Update(task);
            entry = _context.Entry(task);
        }

        var originalTitle = persisted?.Title ?? entry.OriginalValues.GetValue<string>(nameof(TaskItem.Title));
        var originalDescription = persisted?.Description ?? entry.OriginalValues.GetValue<string?>(nameof(TaskItem.Description));
        var originalPriority = persisted?.Priority ?? entry.OriginalValues.GetValue<Priority>(nameof(TaskItem.Priority));
        var originalStatus = persisted?.Status ?? entry.OriginalValues.GetValue<Status>(nameof(TaskItem.Status));
        var originalIsComplete = persisted?.IsComplete ?? entry.OriginalValues.GetValue<bool>(nameof(TaskItem.IsComplete));
        var originalDueDate = persisted?.DueDate ?? entry.OriginalValues.GetValue<DateTime?>(nameof(TaskItem.DueDate));

        if (!string.Equals(originalTitle, task.Title, StringComparison.Ordinal))
        {
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "TitleChanged",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = $"Title changed from '{originalTitle}' to '{task.Title}'."
            });
        }

        if (originalPriority != task.Priority)
        {
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "PriorityChanged",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = $"Priority changed from {originalPriority} to {task.Priority}."
            });
        }

        if (!string.Equals(originalDescription, task.Description, StringComparison.Ordinal))
        {
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "DescriptionChanged",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = "Description updated."
            });
        }

        if (originalDueDate != task.DueDate)
        {
            _context.TaskItemEvents.Add(new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "DueDateChanged",
                OccurredAtUtc = DateTime.UtcNow,
                ChangeSummary = $"Due date changed from {FormatDueDate(originalDueDate)} to {FormatDueDate(task.DueDate)}."
            });
        }

        var wasCompleted = IsCompleted(originalIsComplete, originalStatus);
        var isCompletedNow = IsCompleted(task.IsComplete, task.Status);
        if (!wasCompleted && isCompletedNow)
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

    private static bool IsCompleted(bool isComplete, Status status) =>
        isComplete || status == Status.Completed;

    private static string FormatDueDate(DateTime? value) =>
        value?.ToString("yyyy-MM-dd") ?? "none";
}
