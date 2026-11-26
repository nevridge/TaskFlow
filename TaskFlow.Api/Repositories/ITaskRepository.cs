using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface ITaskRepository
{
    Task<IEnumerable<TaskItem>> GetAllAsync();
    Task<TaskItem?> GetByIdAsync(int id);
    Task<TaskItem?> GetByIdNoTrackingAsync(int id);
    Task<IEnumerable<TaskItem>> GetChildrenAsync(int parentId);
    /// <summary>True when the task has at least one subtask that is not Completed (Blocked counts as open).</summary>
    Task<bool> HasOpenSubtasksAsync(int taskId);
    Task<DateOnly?> GetAssignedJournalDateAsync(int taskId);
    Task<IReadOnlyDictionary<int, DateOnly>> GetAssignedJournalDatesAsync(IReadOnlyCollection<int> taskIds);
    Task<IReadOnlyDictionary<int, DateOnly>> GetLastMovedDatesAsync(IReadOnlyCollection<int> taskIds);
    Task<IEnumerable<TaskItemEvent>> GetHistoryAsync(int taskId);
    Task<TaskItem> AddAsync(TaskItem task);
    Task UpdateAsync(TaskItem task);
    Task DeleteAsync(int id);

    /// <summary>
    /// The Now goal that stops tasks of <paramref name="goalId"/> from being started or completed: set only when that
    /// goal is Next or Parked and its project has a Now goal, otherwise null.
    /// </summary>
    Task<Goal?> GetBlockingNowGoalAsync(int goalId);

    /// <summary>The goal a subtask in <paramref name="projectId"/> takes from its parent, or null.</summary>
    Task<int?> GetInheritedGoalIdAsync(int parentId, int projectId);

    /// <summary>
    /// Changes the goal of a tracked task, keeping the <c>Goal</c> navigation consistent. Saved by <see cref="UpdateAsync"/>.
    /// </summary>
    Task SetGoalAsync(TaskItem task, int? goalId);

    /// <summary>
    /// Starts a database transaction on the shared scoped context. Every save made through any repository
    /// on that context until commit is rolled back if the returned transaction is disposed uncommitted.
    /// </summary>
    Task<IRepositoryTransaction> BeginTransactionAsync();
}
