using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Repositories;

/// <summary>
/// Goal writes each run in one transaction; disposing without a commit rolls back, so every early return leaves the
/// data unchanged. Concurrent requests can leave two Now goals, so the Now goal is never read with Single.
/// </summary>
public class GoalRepository(TaskDbContext context) : IGoalRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IReadOnlyList<Goal>> GetAllAsync(int? projectId = null, GoalStatus? status = null)
    {
        var goals = await _context.Goals
            .AsNoTracking()
            .Include(g => g.Tasks)
            .Where(g => (projectId == null || g.ProjectId == projectId) && (status == null || g.Status == status))
            .ToListAsync();

        return [.. goals
            .OrderBy(g => g.ProjectId)
            .ThenBy(g => StatusRank(g.Status))
            .ThenBy(g => g.Status == GoalStatus.Next ? g.DisplayOrder : 0)
            .ThenByDescending(g => g.Status switch
            {
                GoalStatus.Parked => g.StatusChangedAt,
                GoalStatus.Done or GoalStatus.Dropped => g.ClosedAt,
                _ => null,
            })
            .ThenBy(g => g.Id)];
    }

    public async Task<Goal?> GetByIdAsync(int id) =>
        await _context.Goals
            .AsNoTracking()
            .Include(g => g.Tasks)
            .FirstOrDefaultAsync(g => g.Id == id);

    public async Task<GoalWriteResult> CreateAsync(Goal goal)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();

        if (!await _context.Projects.AnyAsync(p => p.Id == goal.ProjectId))
        {
            return new GoalWriteResult(GoalWriteStatus.ProjectNotFound);
        }

        if (goal.Status == GoalStatus.Now && await FindNowAsync(goal.ProjectId) is not null)
        {
            return new GoalWriteResult(GoalWriteStatus.NowExists);
        }

        var now = DateTime.UtcNow;
        goal.CreatedAt = now;
        goal.StatusChangedAt = now;
        goal.DisplayOrder = goal.Status == GoalStatus.Next ? await NextOrderAsync(goal.ProjectId) : 0;

        _context.Goals.Add(goal);
        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return new GoalWriteResult(GoalWriteStatus.Success, goal.Id);
    }

    public async Task<GoalWriteResult> UpdateAsync(int id, Goal changes)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();

        var goal = await _context.Goals.FindAsync(id);
        if (goal is null)
        {
            return new GoalWriteResult(GoalWriteStatus.NotFound);
        }

        var now = DateTime.UtcNow;
        var status = changes.Status;
        if (status != goal.Status)
        {
            if (status == GoalStatus.Now && await FindNowAsync(goal.ProjectId) is not null)
            {
                return new GoalWriteResult(GoalWriteStatus.NowExists);
            }

            if (goal.Status == GoalStatus.Now && status is GoalStatus.Next or GoalStatus.Parked)
            {
                var inProgress = await TaskRefsAsync(t => t.GoalId == id && t.Status == Status.InProgress);
                if (inProgress.Count > 0)
                {
                    return new GoalWriteResult(GoalWriteStatus.NowHasInProgressTasks, id, inProgress);
                }
            }

            if (IsClosed(status))
            {
                var open = await TaskRefsAsync(t => t.GoalId == id && t.Status != Status.Completed);
                if (open.Count > 0)
                {
                    return new GoalWriteResult(GoalWriteStatus.HasOpenTasks, id, open);
                }
            }

            if (status == GoalStatus.Next)
            {
                goal.DisplayOrder = await NextOrderAsync(goal.ProjectId);
            }

            SetStatus(goal, status, now);
        }

        goal.Title = changes.Title;
        goal.Description = changes.Description;
        goal.DoneWhen = changes.DoneWhen;
        goal.ParkedReason = status == GoalStatus.Parked ? changes.ParkedReason : null;
        goal.UpdatedAt = now;

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return new GoalWriteResult(GoalWriteStatus.Success, id);
    }

    public async Task<bool> ReorderAsync(int projectId, IReadOnlyList<int> goalIds)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();

        var goals = await _context.Goals
            .Where(g => g.ProjectId == projectId && g.Status == GoalStatus.Next)
            .ToDictionaryAsync(g => g.Id);
        if (goalIds.Count != goals.Count
            || goalIds.Distinct().Count() != goalIds.Count
            || !goalIds.All(goals.ContainsKey))
        {
            return false;
        }

        for (var index = 0; index < goalIds.Count; index++)
        {
            goals[goalIds[index]].DisplayOrder = index;
        }

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return true;
    }

    public async Task<GoalWriteResult> SwapNowAsync(int id)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();

        var target = await _context.Goals.FindAsync(id);
        if (target is null)
        {
            return new GoalWriteResult(GoalWriteStatus.NotFound);
        }

        if (target.Status == GoalStatus.Now)
        {
            return new GoalWriteResult(GoalWriteStatus.Success, id);
        }

        if (IsClosed(target.Status))
        {
            return new GoalWriteResult(GoalWriteStatus.Closed);
        }

        var now = DateTime.UtcNow;
        var current = await FindNowAsync(target.ProjectId);
        if (current is not null)
        {
            var inProgress = await TaskRefsAsync(t => t.GoalId == current.Id && t.Status == Status.InProgress);
            if (inProgress.Count > 0)
            {
                return new GoalWriteResult(GoalWriteStatus.NowHasInProgressTasks, current.Id, inProgress);
            }

            var others = await _context.Goals
                .Where(g => g.ProjectId == target.ProjectId && g.Status == GoalStatus.Next && g.Id != id)
                .OrderBy(g => g.DisplayOrder)
                .ThenBy(g => g.Id)
                .ToListAsync();
            for (var index = 0; index < others.Count; index++)
            {
                others[index].DisplayOrder = index + 1;
            }

            SetStatus(current, GoalStatus.Next, now);
            current.DisplayOrder = 0;
            current.UpdatedAt = now;
        }

        SetStatus(target, GoalStatus.Now, now);
        target.ParkedReason = null;
        target.UpdatedAt = now;

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return new GoalWriteResult(GoalWriteStatus.Success, id);
    }

    public async Task<bool> DeleteAsync(int id)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();

        var goal = await _context.Goals.FindAsync(id);
        if (goal is null)
        {
            return false;
        }

        foreach (var task in await _context.TaskItems.Where(t => t.GoalId == id).ToListAsync())
        {
            task.GoalId = null;
        }

        await _context.SaveChangesAsync();

        _context.Goals.Remove(goal);
        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return true;
    }

    public async Task<AssignGoalTaskResult> AssignTaskAsync(int goalId, int taskItemId)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();

        var goal = await _context.Goals.FindAsync(goalId);
        if (goal is null)
        {
            return new AssignGoalTaskResult(AssignGoalTaskStatus.GoalNotFound);
        }

        var task = await _context.TaskItems.FindAsync(taskItemId);
        if (task is null)
        {
            return new AssignGoalTaskResult(AssignGoalTaskStatus.TaskNotFound);
        }

        if (task.ParentTaskItemId is not null)
        {
            return new AssignGoalTaskResult(AssignGoalTaskStatus.IsSubtask);
        }

        if (task.ProjectId != goal.ProjectId)
        {
            return new AssignGoalTaskResult(AssignGoalTaskStatus.WrongProject);
        }

        if (IsClosed(goal.Status))
        {
            return new AssignGoalTaskResult(AssignGoalTaskStatus.GoalClosed);
        }

        if (task.GoalId == goalId)
        {
            return new AssignGoalTaskResult(AssignGoalTaskStatus.AlreadyAssigned);
        }

        // Only subtasks in the goal's project take the goal with their parent.
        var subtasks = await _context.TaskItems
            .Where(t => t.ParentTaskItemId == taskItemId && t.ProjectId == goal.ProjectId)
            .ToListAsync();
        List<TaskItem> moving = [task, .. subtasks];

        if (goal.Status is GoalStatus.Next or GoalStatus.Parked
            && moving.Any(t => t.Status == Status.InProgress)
            && await FindNowAsync(goal.ProjectId) is { } nowGoal)
        {
            return new AssignGoalTaskResult(AssignGoalTaskStatus.GoalNotNow, nowGoal);
        }

        foreach (var item in moving)
        {
            item.GoalId = goalId;
        }

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return new AssignGoalTaskResult(AssignGoalTaskStatus.Success);
    }

    public async Task<RemoveGoalTaskResult> RemoveTaskAsync(int goalId, int taskItemId)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();

        var task = await _context.TaskItems.FindAsync(taskItemId);
        if (task is null || !await _context.Goals.AnyAsync(g => g.Id == goalId))
        {
            return RemoveGoalTaskResult.NotFound;
        }

        if (task.ParentTaskItemId is not null)
        {
            return RemoveGoalTaskResult.IsSubtask;
        }

        if (task.GoalId != goalId)
        {
            return RemoveGoalTaskResult.NotFound;
        }

        var subtasks = await _context.TaskItems
            .Where(t => t.ParentTaskItemId == taskItemId && t.GoalId == goalId)
            .ToListAsync();
        foreach (var item in subtasks.Append(task))
        {
            item.GoalId = null;
        }

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return RemoveGoalTaskResult.Success;
    }

    private static bool IsClosed(GoalStatus status) => status is GoalStatus.Done or GoalStatus.Dropped;

    private static int StatusRank(GoalStatus status) => status switch
    {
        GoalStatus.Now => 0,
        GoalStatus.Next => 1,
        GoalStatus.Parked => 2,
        _ => 3,
    };

    /// <summary>Writes a status change and its timestamps. ClosedAt is renewed on Done to Dropped and back.</summary>
    private static void SetStatus(Goal goal, GoalStatus status, DateTime now)
    {
        goal.Status = status;
        goal.StatusChangedAt = now;
        goal.ClosedAt = IsClosed(status) ? now : null;
    }

    private async Task<Goal?> FindNowAsync(int projectId) =>
        await _context.Goals.FirstOrDefaultAsync(g => g.ProjectId == projectId && g.Status == GoalStatus.Now);

    private async Task<int> NextOrderAsync(int projectId)
    {
        var lastOrder = await _context.Goals
            .Where(g => g.ProjectId == projectId && g.Status == GoalStatus.Next)
            .MaxAsync(g => (int?)g.DisplayOrder);
        return lastOrder + 1 ?? 0;
    }

    private async Task<List<GoalTaskRef>> TaskRefsAsync(System.Linq.Expressions.Expression<Func<TaskItem, bool>> predicate) =>
        await _context.TaskItems
            .Where(predicate)
            .OrderBy(t => t.Id)
            .Select(t => new GoalTaskRef(t.Id, t.Title))
            .ToListAsync();
}
