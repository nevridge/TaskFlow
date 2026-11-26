using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Helpers;

/// <summary>The 422 bodies <c>{ code, message, details }</c> of the goal rules.</summary>
public static class GoalRuleErrors
{
    // The plain { message } refusals of putting a task into a goal. Shared by the Goals and TaskItems controllers.
    public const string GoalNotFoundMessage = "Goal not found.";
    public const string SubtaskGoalMessage = "A subtask's goal follows its parent and cannot be set directly.";
    public const string WrongProjectMessage = "The task must be in the goal's project.";
    public const string GoalClosedMessage = "Tasks cannot be added to a Done or Dropped goal.";

    /// <summary>The message of a failed explicit-goal check, or null when the check passed.</summary>
    public static string? CheckMessage(AssignGoalTaskStatus status) => status switch
    {
        AssignGoalTaskStatus.GoalNotFound => GoalNotFoundMessage,
        AssignGoalTaskStatus.IsSubtask => SubtaskGoalMessage,
        AssignGoalTaskStatus.WrongProject => WrongProjectMessage,
        AssignGoalTaskStatus.GoalClosed => GoalClosedMessage,
        _ => null,
    };

    public static string PositionNotNextMessage(string status) =>
        $"position only applies to a Next goal, and this one would be {status}.";

    public static string PositionOutOfRangeMessage(int position, int max) =>
        $"position {position} is out of range: use 1 to {max}.";

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
