using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IProjectRepository
{
    /// <summary>Returns all projects with their tasks loaded (used for open/completed counts).</summary>
    Task<IEnumerable<Project>> GetAllAsync();
    Task<Project?> GetByIdAsync(int id);
    Task<Project?> GetByIdNoTrackingAsync(int id);
    Task<bool> NameExistsAsync(string name, int? excludeProjectId = null);
    Task<IEnumerable<TaskItem>> GetTasksAsync(int projectId);
    Task<Project> AddAsync(Project project);
    Task UpdateAsync(Project project);
    Task DeleteAsync(int id);

    /// <summary>
    /// Assigns a task to the project. A task already in another project is moved.
    /// Records a ProjectChanged task event.
    /// </summary>
    Task<AssignTaskResult> AssignTaskAsync(int projectId, int taskItemId);

    /// <summary>
    /// Why the single-Now rule refuses this move, or null when it does not: an InProgress subtask moved into its
    /// parent's project takes the parent's goal, which must not be Next or Parked while the project has a Now goal.
    /// </summary>
    Task<BlockedGoalMove?> GetBlockedGoalMoveAsync(int projectId, int taskItemId);

    /// <summary>
    /// Removes a task from the project. Returns false when the task is not in that project.
    /// Records a ProjectChanged task event.
    /// </summary>
    Task<bool> UnassignTaskAsync(int projectId, int taskItemId);
}
