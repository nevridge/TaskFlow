using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TaskFlow.Api.Tests.Infrastructure;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// The area contract over the real HTTP pipeline (JSON names, routing and query binding), which the web
/// client and the assistant are written against. Each test gets its own database.
/// </summary>
public sealed class AreasHttpTests : IAsyncDisposable
{
    private readonly ApiVersioningFactory _factory = new();
    private readonly HttpClient _client;

    public AreasHttpTests()
    {
        _client = _factory.CreateClient();
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private async Task<JsonElement> GetJsonAsync(string url) => await _client.GetFromJsonAsync<JsonElement>(url, Ct);

    private async Task<int> PostAsync(string url, object body)
    {
        using var response = await _client.PostAsJsonAsync(url, body, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetInt32();
    }

    private Task<int> CreateAreaAsync(string name) => PostAsync("/api/v1/Areas", new { name });

    private Task<int> CreateProjectAsync(string name, int areaId) => PostAsync("/api/v1/Projects", new { name, areaId });

    [Fact]
    public async Task AreaAndProjectJson_UsesTheContractNames()
    {
        var areaId = await CreateAreaAsync("Work");
        var projectId = await CreateProjectAsync("Alpha", areaId);

        var area = (await GetJsonAsync("/api/v1/Areas"))[0];
        var project = await GetJsonAsync($"/api/v1/Projects/{projectId}");
        var listed = (await GetJsonAsync("/api/v1/Projects"))[0];

        Assert.Equal("Work", area.GetProperty("name").GetString());
        Assert.Equal(0, area.GetProperty("displayOrder").GetInt32());
        Assert.Equal(1, area.GetProperty("projectCount").GetInt32());
        Assert.All(new[] { project, listed }, p =>
        {
            Assert.Equal(areaId, p.GetProperty("areaId").GetInt32());
            Assert.Equal("Work", p.GetProperty("areaName").GetString());
        });
    }

    [Fact]
    public async Task PutOrder_ReachesReorder_NotTheIdRoute()
    {
        var a = await CreateAreaAsync("A");
        var b = await CreateAreaAsync("B");

        using var response = await _client.PutAsJsonAsync("/api/v1/Areas/order", new { areaIds = new[] { b, a } }, Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var areas = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal([b, a], areas.EnumerateArray().Select(x => x.GetProperty("id").GetInt32()));
    }

    [Fact]
    public async Task Delete_BindsMoveToAreaId()
    {
        var source = await CreateAreaAsync("Work");
        var target = await CreateAreaAsync("Home");
        var projectId = await CreateProjectAsync("Alpha", source);

        using var response = await _client.DeleteAsync($"/api/v1/Areas/{source}?moveToAreaId={target}", Ct);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(target, (await GetJsonAsync($"/api/v1/Projects/{projectId}")).GetProperty("areaId").GetInt32());
    }

    [Fact]
    public async Task Delete_BindsAnEncodedNewAreaName()
    {
        const string name = "Home & Garden";
        var source = await CreateAreaAsync("Work");
        var projectId = await CreateProjectAsync("Alpha", source);

        using var response = await _client.DeleteAsync(
            $"/api/v1/Areas/{source}?newAreaName={Uri.EscapeDataString(name)}", Ct);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(name, (await GetJsonAsync($"/api/v1/Projects/{projectId}")).GetProperty("areaName").GetString());
    }

    [Fact]
    public async Task Delete_BindsNoArea()
    {
        var source = await CreateAreaAsync("Work");
        var projectId = await CreateProjectAsync("Alpha", source);

        using var refused = await _client.DeleteAsync($"/api/v1/Areas/{source}?noArea=false", Ct);
        using var response = await _client.DeleteAsync($"/api/v1/Areas/{source}?noArea=true", Ct);

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var project = await GetJsonAsync($"/api/v1/Projects/{projectId}");
        Assert.Equal(JsonValueKind.Null, project.GetProperty("areaId").ValueKind);
    }
}
