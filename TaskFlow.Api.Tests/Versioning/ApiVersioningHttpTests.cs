using System.Net;
using System.Net.Http.Json;
using TaskFlow.Api.Tests.Infrastructure;

namespace TaskFlow.Api.Tests.Versioning;

/// <summary>
/// Characterisation tests for API versioning over the real HTTP pipeline. They exist so that a bump of
/// Asp.Versioning.* is measurable: the /api/v1 behaviour must not change.
/// </summary>
public sealed class ApiVersioningHttpTests : IClassFixture<ApiVersioningFactory>
{
    private readonly ApiVersioningFactory _factory;

    public ApiVersioningHttpTests(ApiVersioningFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Get_V1TaskItems_Returns200AndReportsVersion1()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync("/api/v1/TaskItems", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("1.0", response.Headers.GetValues("api-supported-versions").SelectMany(v => v.Split(',')).Select(v => v.Trim()));
    }

    [Fact]
    public async Task Get_V1TaskItems_WithMatchingHeader_Returns200()
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("x-api-version", "1.0");

        using var response = await client.GetAsync("/api/v1/TaskItems", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Post_V1Projects_Returns201WithVersionedLocation()
    {
        using var client = _factory.CreateClient();
        var body = new { name = "versioning-" + Guid.NewGuid().ToString("N"), description = "created by versioning test" };

        using var response = await client.PostAsJsonAsync("/api/v1/Projects", body, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(response.Headers.Location);
        // Baseline on 8.1.1: CreatedAtRoute renders the version route value "1.0" as /api/v1.0/..., not /api/v1/.
        Assert.StartsWith("/api/v1.0/Projects/", response.Headers.Location!.AbsolutePath, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Get_UnsupportedVersion_ReturnsRecordedStatusAndProblemBody()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync("/api/v9/TaskItems", TestContext.Current.CancellationToken);
        var content = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Null(response.Content.Headers.ContentType);
        Assert.Empty(content);
    }

    [Fact]
    public async Task Get_UnversionedTaskItems_ReturnsRecordedStatus()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync("/api/TaskItems", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_UnversionedTaskItems_WithHeader_ReturnsRecordedStatus()
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("x-api-version", "1.0");

        using var response = await client.GetAsync("/api/TaskItems", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_UrlV1WithConflictingHeader_RecordsOutcomeOnly()
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("x-api-version", "2.0");

        using var response = await client.GetAsync("/api/v1/TaskItems", TestContext.Current.CancellationToken);

        // Record only: the outcome is deliberately not part of the supported contract.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
