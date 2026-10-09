using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IProjectRepository
{
    /// <summary>Returns all projects with their tasks loaded (used for open/completed counts).</summary>
    Task<IEnumerable<Project>> GetAllAsync();
    Task<Project?> GetByIdAsync(int id);
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
    /// Removes a task from the project. Returns false when the task is not in that project.
    /// Records a ProjectChanged task event.
    /// </summary>
    Task<bool> UnassignTaskAsync(int projectId, int taskItemId);
}
