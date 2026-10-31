using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IJournalEntryRepository
{
    Task<IEnumerable<JournalEntry>> GetAllAsync();
    Task<JournalEntry?> GetByIdAsync(int id);
    Task<JournalEntry?> GetByDateAsync(DateOnly date);
    Task<JournalEntry> AddAsync(JournalEntry entry);
    Task UpdateAsync(JournalEntry entry);
    Task DeleteAsync(int id);
    Task<IEnumerable<TaskItem>> GetTodosAsync(int entryId);
    /// <summary>
    /// Tasks that are todo rows on the entry's day under <see cref="Helpers.JournalDayRule"/> (null when the entry is missing).
    /// Subtasks are returned as rows of their own, with their parent loaded so it can be shown as context.
    /// </summary>
    Task<JournalDayTodos?> GetTodosForDayAsync(int entryId, int? offsetMinutes);
    /// <summary>Root task ids per entry under the same day rule, in one batched query. Every requested entry has a key.</summary>
    Task<IReadOnlyDictionary<int, List<int>>> GetTodoTaskItemIdsAsync(IReadOnlyCollection<(int EntryId, DateOnly Date)> entries, int? offsetMinutes);
    /// <summary>The facts behind a <see cref="AddTodoResult.TaskCompleted"/> rejection; null when entry or task is missing.</summary>
    Task<PlanCompletedDetails?> GetPlanCompletedDetailsAsync(int entryId, int taskItemId);
    Task<bool> TodoExistsAsync(int entryId, int taskItemId);
    Task<AddTodoResult> AddTodoAsync(int entryId, int taskItemId, int? timezoneOffsetMinutes = null);
    Task<bool> RemoveTodoAsync(int entryId, int taskItemId);
    Task<IReadOnlyList<int>> CarryForwardIncompleteTasksAsync(int entryId, DateOnly userToday);
}
