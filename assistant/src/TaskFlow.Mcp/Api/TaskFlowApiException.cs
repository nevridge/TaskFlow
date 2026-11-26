using System.Net;
using System.Text.Json;

namespace TaskFlow.Mcp.Api;

/// <summary>A non-success response from the TaskFlow API, with its error code and message extracted.</summary>
public sealed class TaskFlowApiException : Exception
{
    public TaskFlowApiException(HttpStatusCode status, string? code, string message, JsonElement? details = null)
        : base(message)
    {
        Status = status;
        Code = code;
        Details = details;
    }

    public HttpStatusCode Status { get; }

    /// <summary>The API's machine-readable code (for example TASK_PARENT_NOT_FOUND), when it sent one.</summary>
    public string? Code { get; }

    /// <summary>The <c>details</c> member of the error body, when it sent one. Its shape depends on the code.</summary>
    public JsonElement? Details { get; }
}
