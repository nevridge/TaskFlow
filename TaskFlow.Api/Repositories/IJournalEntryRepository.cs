using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IJournalEntryRepository
{
    Task<IEnumerable<JournalEntry>> GetAllAsync();
    Task<JournalEntry?> GetByIdAsync(int id);
    Task<JournalEntry?> GetByDateAsync(DateOnly date);
    Task<JournalEntry> AddAsync(JournalEntry entry);
    Task UpdateAsync(JournalEntry entry);

    /// <summary>
    /// Appends already-trimmed <paramref name="text"/> to the entry's summary: it becomes the summary when that is null
    /// or blank, otherwise <c>existing.TrimEnd() + "\n\n" + text</c>. The read-combine-write is one compare-and-swap
    /// UPDATE, retried when another writer changed the summary in between, so concurrent appends all survive. Nothing
    /// is written when the result would pass the summary maximum.
    /// </summary>
    Task<AppendSummaryResult> AppendSummaryAsync(int id, string text);

    Task DeleteAsync(int id);
    Task<IEnumerable<TaskItem>> GetTodosAsync(int entryId);
    /// <summary>
    /// Tasks that are todo rows on the entry's day under <see cref="Helpers.JournalDayRule"/> (null when the entry is missing).
    /// Subtasks are returned as rows of their own, with their parent loaded so it can be shown as context.
    /// </summary>
    Task<JournalDayTodos?> GetTodosForDayAsync(int entryId, int? offsetMinutes);
    /// <summary>Task ids (roots and subtasks) per entry under the same day rule, in one batched query. Every requested entry has a key.</summary>
    Task<IReadOnlyDictionary<int, List<int>>> GetTodoTaskItemIdsAsync(IReadOnlyCollection<(int EntryId, DateOnly Date)> entries, int? offsetMinutes);
    /// <summary>The facts behind a <see cref="AddTodoResult.TaskCompleted"/> rejection; null when entry or task is missing.</summary>
    Task<PlanCompletedDetails?> GetPlanCompletedDetailsAsync(int entryId, int taskItemId);
    Task<bool> TodoExistsAsync(int entryId, int taskItemId);
    Task<AddTodoResult> AddTodoAsync(int entryId, int taskItemId, int? timezoneOffsetMinutes = null);
    Task<bool> RemoveTodoAsync(int entryId, int taskItemId);
    Task<IReadOnlyList<int>> CarryForwardIncompleteTasksAsync(int entryId, DateOnly userToday);
}

public enum AppendSummaryStatus
{
    Success,
    NotFound,
    TooLong,
}

/// <summary>
/// Outcome of a summary append. The lengths are set for <see cref="AppendSummaryStatus.TooLong"/>:
/// <see cref="ExistingLength"/> is the stored summary after its trailing whitespace is trimmed (0 when blank),
/// <see cref="TextLength"/> the appended text and <see cref="CombinedLength"/> the result that was refused.
/// </summary>
public sealed record AppendSummaryResult(
    AppendSummaryStatus Status,
    int ExistingLength = 0,
    int TextLength = 0,
    int CombinedLength = 0);
