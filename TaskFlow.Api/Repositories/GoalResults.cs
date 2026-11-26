using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

/// <summary>A task named in a goal rule rejection; serialised as <c>{ id, title }</c>.</summary>
public sealed record GoalTaskRef(int Id, string Title);

public enum GoalWriteStatus
{
    Success,
    NotFound,
    ProjectNotFound,
    NowExists,
    Closed,
    NowHasInProgressTasks,
    HasOpenTasks,
    PositionOutOfRange,
}

/// <summary>
/// Outcome of a goal create, edit or swap. <see cref="GoalId"/> is the saved goal, or for
/// <see cref="GoalWriteStatus.NowHasInProgressTasks"/> the Now goal that holds <see cref="Tasks"/>.
/// <see cref="MaxPosition"/> is set only for <see cref="GoalWriteStatus.PositionOutOfRange"/>.
/// </summary>
public sealed record GoalWriteResult(
    GoalWriteStatus Status,
    int GoalId = 0,
    IReadOnlyList<GoalTaskRef>? Tasks = null,
    int MaxPosition = 0);

public enum AssignGoalTaskStatus
{
    Success,
    GoalNotFound,
    TaskNotFound,
    IsSubtask,
    WrongProject,
    GoalClosed,
    AlreadyAssigned,
    GoalNotNow,
}

/// <summary><see cref="NowGoal"/> is set only for <see cref="AssignGoalTaskStatus.GoalNotNow"/>.</summary>
public sealed record AssignGoalTaskResult(AssignGoalTaskStatus Status, Goal? NowGoal = null);

/// <summary>
/// Outcome of the explicit-goal checks shared by goal assign and task create/patch. <see cref="Goal"/> is set on success.
/// </summary>
public sealed record GoalAssignmentCheck(AssignGoalTaskStatus Status, Goal? Goal = null);

public enum RemoveGoalTaskResult
{
    Success,
    NotFound,
    IsSubtask,
}
