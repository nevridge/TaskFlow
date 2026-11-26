using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Repositories;

public class ProjectRepository(TaskDbContext context) : IProjectRepository
{
    private const string ProjectChangedEventType = "ProjectChanged";
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<Project>> GetAllAsync() =>
        await _context.Projects
            .AsNoTracking()
            .Include(p => p.Tasks)
            .Include(p => p.Area)
            .OrderBy(p => p.Name)
            .ToListAsync();

    public async Task<Project?> GetByIdAsync(int id) =>
        await _context.Projects
            .Include(p => p.Tasks)
            .FirstOrDefaultAsync(p => p.Id == id);

    public async Task<Project?> GetByIdNoTrackingAsync(int id) =>
        // Read-only query: AsNoTracking avoids change-tracking overhead; callers must not mutate or Update the result.
        await _context.Projects
            .AsNoTracking()
            .Include(p => p.Tasks)
            .Include(p => p.Area)
            .FirstOrDefaultAsync(p => p.Id == id);

    public async Task<bool> NameExistsAsync(string name, int? excludeProjectId = null) =>
        await _context.Projects.AnyAsync(p => p.Name == name && (excludeProjectId == null || p.Id != excludeProjectId));

    public async Task<IEnumerable<TaskItem>> GetTasksAsync(int projectId) =>
        await _context.TaskItems
            .AsNoTracking()
            .Include(t => t.Project)
            .Include(t => t.Goal)
            .Where(t => t.ProjectId == projectId)
            .ToListAsync();

    public async Task<Project> AddAsync(Project project)
    {
        project.CreatedAt = DateTime.UtcNow;
        _context.Projects.Add(project);
        await _context.SaveChangesAsync();
        return project;
    }

    public async Task UpdateAsync(Project project)
    {
        project.UpdatedAt = DateTime.UtcNow;

        // Tracked entities (loaded via GetByIdAsync) need no Update call because change detection
        // picks up their edits; Update is only required to attach a Detached entity.
        if (_context.Entry(project).State == EntityState.Detached)
        {
            _context.Projects.Update(project);
        }

        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var project = await _context.Projects.FindAsync(id);
        if (project is null)
        {
            return;
        }

        _context.Projects.Remove(project);
        await _context.SaveChangesAsync();
    }

    public async Task<AssignTaskResult> AssignTaskAsync(int projectId, int taskItemId)
    {
        var project = await _context.Projects.FindAsync(projectId);
        if (project is null)
        {
            return AssignTaskResult.ProjectNotFound;
        }

        var task = await _context.TaskItems
            .Include(t => t.Project)
            .FirstOrDefaultAsync(t => t.Id == taskItemId);
        if (task is null)
        {
            return AssignTaskResult.TaskNotFound;
        }

        if (task.ProjectId == projectId)
        {
            return AssignTaskResult.AlreadyAssigned;
        }

        await StageProjectMoveAsync(task, project);

        await _context.SaveChangesAsync();
        return AssignTaskResult.Success;
    }

    public async Task StageProjectChangeAsync(TaskItem task, int? projectId)
    {
        Project? project = null;
        if (projectId is int id)
        {
            project = await _context.Projects.FindAsync(id)
                ?? throw new KeyNotFoundException($"Project {id} was not found.");
        }

        await StageProjectMoveAsync(task, project);
    }

    /// <summary>
    /// Moves a tracked task to <paramref name="project"/> (null removes it from its project) without saving: sets the
    /// project, resets the goals and adds the ProjectChanged event. Shared by assign, unassign and the task PATCH, so
    /// each persists it in its own single save.
    /// </summary>
    private async Task StageProjectMoveAsync(TaskItem task, Project? project)
    {
        var previousName = task.Project?.Name;
        if (previousName is null && task.ProjectId is int previousId)
        {
            previousName = await _context.Projects
                .Where(p => p.Id == previousId)
                .Select(p => p.Name)
                .FirstOrDefaultAsync();
        }

        task.ProjectId = project?.Id;
        task.Project = project;
        await ResetGoalsAfterMoveAsync(task);

        _context.TaskItemEvents.Add(new TaskItemEvent
        {
            TaskItemId = task.Id,
            EventType = ProjectChangedEventType,
            OccurredAtUtc = DateTime.UtcNow,
            ChangeSummary = project is null
                ? $"Removed from project '{previousName}'."
                : previousName is null
                    ? $"Assigned to project '{project.Name}'."
                    : $"Project changed from '{previousName}' to '{project.Name}'."
        });
    }

    public async Task<BlockedGoalMove?> GetBlockedGoalMoveAsync(int projectId, int taskItemId)
    {
        var task = await _context.TaskItems.AsNoTracking().FirstOrDefaultAsync(t => t.Id == taskItemId);
        if (task is not { Status: Status.InProgress, ParentTaskItemId: int parentId } || task.ProjectId == projectId)
        {
            return null;
        }

        if (await TaskRepository.InheritedGoalIdAsync(_context, parentId, projectId) is not int goalId)
        {
            return null;
        }

        var nowGoal = await TaskRepository.BlockingNowGoalAsync(_context, goalId);
        return nowGoal is null ? null : new BlockedGoalMove(goalId, nowGoal);
    }

    public async Task<bool> UnassignTaskAsync(int projectId, int taskItemId)
    {
        var task = await _context.TaskItems
            .Include(t => t.Project)
            .FirstOrDefaultAsync(t => t.Id == taskItemId && t.ProjectId == projectId);
        if (task is null)
        {
            return false;
        }

        await StageProjectMoveAsync(task, null);

        await _context.SaveChangesAsync();
        return true;
    }

    /// <summary>
    /// A goal belongs to one project, so a move clears the task's goal and its subtasks' goals. A moved subtask that
    /// lands in its parent goal's project takes that goal again; GetBlockedGoalMoveAsync refuses that first for an
    /// InProgress subtask whose parent's goal is not Now while the project has one. The caller saves.
    /// </summary>
    private async Task ResetGoalsAfterMoveAsync(TaskItem task)
    {
        var goalId = task.ParentTaskItemId is int parentId && task.ProjectId is int projectId
            ? await TaskRepository.InheritedGoalIdAsync(_context, parentId, projectId)
            : null;
        // The tracked navigation moves with the id, so a later TaskRepository.UpdateAsync does not undo the reset.
        task.Goal = goalId is int id ? await _context.Goals.FindAsync(id) : null;
        task.GoalId = goalId;

        var subtasks = await _context.TaskItems
            .Where(t => t.ParentTaskItemId == task.Id && t.GoalId != null)
            .ToListAsync();
        foreach (var subtask in subtasks)
        {
            subtask.GoalId = null;
        }
    }
}
