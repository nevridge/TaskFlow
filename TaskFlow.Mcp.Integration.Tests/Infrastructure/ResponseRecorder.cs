using System.Collections.Concurrent;
using System.Net;

namespace TaskFlow.Mcp.Integration.Tests.Infrastructure;

public sealed record RecordedCall(string Method, string Path, HttpStatusCode Status, string? ApiVersion, string? Body);

/// <summary>Captures every response body the client receives, leaving the body readable for the client.</summary>
public sealed class ResponseRecorder : DelegatingHandler
{
    private readonly ConcurrentQueue<RecordedCall> _calls = new();

    public IReadOnlyList<RecordedCall> Calls => [.. _calls];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var response = await base.SendAsync(request, cancellationToken);

        string? body = null;
        if (response.IsSuccessStatusCode
            && response.Content.Headers.ContentType?.MediaType?.Contains("json", StringComparison.OrdinalIgnoreCase) == true)
        {
            await response.Content.LoadIntoBufferAsync(cancellationToken);
            body = await response.Content.ReadAsStringAsync(cancellationToken);
        }

        string? apiVersion = request.Headers.TryGetValues("x-api-version", out var versions) ? versions.SingleOrDefault() : null;
        _calls.Enqueue(new RecordedCall(request.Method.Method, request.RequestUri!.AbsolutePath, response.StatusCode, apiVersion, body));

        return response;
    }
}
