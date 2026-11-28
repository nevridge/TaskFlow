using TaskFlow.Api.Models;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Repositories;

public interface IGoalRepository
{
    /// <summary>
    /// Untracked goals with their tasks, by project; within a project Now, Next by display order, Parked (latest
    /// first), then Done and Dropped together by closing time (newest first).
    /// </summary>
    Task<IReadOnlyList<Goal>> GetAllAsync(int? projectId = null, GoalStatus? status = null);

    /// <summary>Untracked goal with its tasks.</summary>
    Task<Goal?> GetByIdAsync(int id);

    /// <summary>
    /// Creates a Next (appended last, or at the 1-based <paramref name="position"/>) or Now goal. A position outside
    /// 1..N+1 writes nothing and returns <see cref="GoalWriteStatus.PositionOutOfRange"/>.
    /// </summary>
    Task<GoalWriteResult> CreateAsync(Goal goal, int? position = null);

    /// <summary>
    /// Applies the editable fields and the status of <paramref name="changes"/> to the stored goal. A
    /// <paramref name="position"/> places a Next goal among the project's other Next goals (N excludes the goal itself).
    /// </summary>
    Task<GoalWriteResult> UpdateAsync(int id, Goal changes, int? position = null);

    /// <summary>Writes the order of a project's Next goals; false when the ids are not exactly those goals.</summary>
    Task<bool> ReorderAsync(int projectId, IReadOnlyList<int> goalIds);

    /// <summary>Makes the goal Now; a current Now goal goes to the top of Next.</summary>
    Task<GoalWriteResult> SwapNowAsync(int id);

    /// <summary>Removes the goal; its tasks are kept without a goal.</summary>
    Task<bool> DeleteAsync(int id);

    Task<AssignGoalTaskResult> AssignTaskAsync(int goalId, int taskItemId);

    Task<RemoveGoalTaskResult> RemoveTaskAsync(int goalId, int taskItemId);
}
