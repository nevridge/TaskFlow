namespace TaskFlow.Api.DTOs;

/// <summary>
/// Body of a 422 business-rule rejection on task endpoints, for example
/// <c>TASK_REOPEN_PAST_DAY_NOT_ALLOWED</c> or <c>TASK_PLAN_COMPLETED_NOT_ALLOWED</c>.
/// Contains a machine-readable code, a human-readable message and optional details.
/// </summary>
public class TaskRuleErrorResponseDto
{
    /// <summary>Machine-readable error code.</summary>
    public required string Code { get; set; }

    /// <summary>Human-readable message.</summary>
    public required string Message { get; set; }

    /// <summary>Optional code-specific details (for example <c>assignedDate</c>).</summary>
    public Dictionary<string, object?>? Details { get; set; }
}
