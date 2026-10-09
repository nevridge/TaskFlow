using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class ProjectRepository(TaskDbContext context) : IProjectRepository
{
    private const string ProjectChangedEventType = "ProjectChanged";
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<Project>> GetAllAsync() =>
        await _context.Projects
            .AsNoTracking()
            .Include(p => p.Tasks)
            .OrderBy(p => p.Name)
            .ToListAsync();

    public async Task<Project?> GetByIdAsync(int id) =>
        await _context.Projects
            .Include(p => p.Tasks)
            .FirstOrDefaultAsync(p => p.Id == id);

    public async Task<bool> NameExistsAsync(string name, int? excludeProjectId = null) =>
        await _context.Projects.AnyAsync(p => p.Name == name && (excludeProjectId == null || p.Id != excludeProjectId));

    public async Task<IEnumerable<TaskItem>> GetTasksAsync(int projectId) =>
        await _context.TaskItems
            .Include(t => t.Project)
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

        // Tracked entities (loaded via GetByIdAsync) already carry their changes; calling
        // Update would also mark every loaded task as modified.
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

        var previousName = task.Project?.Name;
        task.ProjectId = projectId;
        task.Project = project;

        _context.TaskItemEvents.Add(new TaskItemEvent
        {
            TaskItemId = task.Id,
            EventType = ProjectChangedEventType,
            OccurredAtUtc = DateTime.UtcNow,
            ChangeSummary = previousName is null
                ? $"Assigned to project '{project.Name}'."
                : $"Project changed from '{previousName}' to '{project.Name}'."
        });

        await _context.SaveChangesAsync();
        return AssignTaskResult.Success;
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

        var previousName = task.Project?.Name;
        task.ProjectId = null;
        task.Project = null;

        _context.TaskItemEvents.Add(new TaskItemEvent
        {
            TaskItemId = task.Id,
            EventType = ProjectChangedEventType,
            OccurredAtUtc = DateTime.UtcNow,
            ChangeSummary = $"Removed from project '{previousName}'."
        });

        await _context.SaveChangesAsync();
        return true;
    }
}
