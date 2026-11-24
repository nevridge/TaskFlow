using System.Net;
using System.Text.Json;
using TaskFlow.Api.Tests.Infrastructure;

namespace TaskFlow.Api.Tests.Versioning;

/// <summary>
/// Guards the OpenAPI document that the generated web client is built from. The document name, the paths
/// and Info must survive an Asp.Versioning.* bump, otherwise operation IDs in the client change.
/// </summary>
public sealed class OpenApiDocumentHttpTests : IClassFixture<DevelopmentApiFactory>
{
    private readonly DevelopmentApiFactory _factory;

    public OpenApiDocumentHttpTests(DevelopmentApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task OpenApiV1_HasTaskFlowInfoAndOnlyV1Paths()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync("/openapi/v1.json", TestContext.Current.CancellationToken);
        var json = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("TaskFlow API", doc.RootElement.GetProperty("info").GetProperty("title").GetString());
        var paths = doc.RootElement.GetProperty("paths").EnumerateObject().Select(p => p.Name).ToList();
        Assert.NotEmpty(paths);
        Assert.All(paths, p => Assert.StartsWith("/api/v1/", p, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Scalar_V1_Returns200()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync("/scalar/v1", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
