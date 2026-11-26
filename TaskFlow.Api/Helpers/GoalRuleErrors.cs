using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Helpers;

/// <summary>The 422 bodies <c>{ code, message, details }</c> of the goal rules.</summary>
public static class GoalRuleErrors
{
    /// <summary>A task in a Next or Parked goal would be started or completed, or moved there while InProgress. <paramref name="taskItemId"/> is null on create.</summary>
    public static object TaskGoalNotNow(int? taskItemId, int goalId, Goal nowGoal) => new
    {
        code = ErrorCodes.TaskGoalNotNow,
        // Clients that do not know the code show only this message.
        message = $"This task's goal is not the current goal ('{nowGoal.Title}' is), so the task can't be started or completed, or moved into that goal while in progress. "
            + "Swap its goal to Now first, or take the task off the goal.",
        details = new { taskItemId, goalId, nowGoalId = nowGoal.Id, nowGoalTitle = nowGoal.Title }
    };

    /// <summary><paramref name="goalId"/> is the Now goal that holds <paramref name="tasks"/>.</summary>
    public static object NowHasInProgressTasks(int goalId, IReadOnlyList<GoalTaskRef> tasks) => new
    {
        code = ErrorCodes.GoalNowHasInProgressTasks,
        message = "The current goal has tasks in progress. Pause or block them first.",
        details = new { goalId, tasks }
    };

    public static object HasOpenTasks(IReadOnlyList<GoalTaskRef> tasks) => new
    {
        code = ErrorCodes.GoalHasOpenTasks,
        message = "This goal still has open tasks. Complete them or take them off the goal first.",
        details = new { openCount = tasks.Count, tasks }
    };
}
