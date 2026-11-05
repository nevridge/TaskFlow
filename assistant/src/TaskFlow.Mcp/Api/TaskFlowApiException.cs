using System.Net;

namespace TaskFlow.Mcp.Api;

/// <summary>A non-success response from the TaskFlow API, with its error code and message extracted.</summary>
public sealed class TaskFlowApiException : Exception
{
    public TaskFlowApiException(HttpStatusCode status, string? code, string message)
        : base(message)
    {
        Status = status;
        Code = code;
    }

    public HttpStatusCode Status { get; }

    /// <summary>The API's machine-readable code (for example TASK_PARENT_NOT_FOUND), when it sent one.</summary>
    public string? Code { get; }
}
