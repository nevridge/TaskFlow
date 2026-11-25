using System.Net;
using ModelContextProtocol;
using TaskFlow.Mcp.Api;
using TaskFlow.Mcp.Integration.Tests.Infrastructure;
using TaskFlow.Mcp.Tools;

namespace TaskFlow.Mcp.Integration.Tests;

/// <summary>
/// The area and project tools against the real API: the assistant's stub tests cannot catch a route, query
/// parameter or JSON field name that differs from what the API actually serves.
/// </summary>
public sealed class AreaFlowTests : IntegrationTestBase
{
    [Fact]
    public async Task AreaTools_KeepProjectAreas_AndMoveThemThroughEachDeleteChoice()
    {
        // Needs URL encoding: unencoded, '&' and '#' would cut the name short and '+' would become a space.
        const string newName = "R&D + Ops #1";
        var areas = new AreaTools(Client);
        var projects = new ProjectTools(Client, TimeProvider.System);

        await areas.SaveArea("Work", ct: Ct);
        await areas.SaveArea("Home", ct: Ct);
        var duplicate = await Assert.ThrowsAsync<McpException>(() => areas.SaveArea(" WORK ", ct: Ct));
        Assert.StartsWith("An area with this name already exists.", duplicate.Message, StringComparison.Ordinal);
        Assert.Equal([("Work", 0), ("Home", 1)], (await Client.GetAreasAsync(Ct)).Select(a => (a.Name, a.DisplayOrder)));

        await projects.SaveProject(name: "Alpha", area: "Work", ct: Ct);
        await projects.SaveProject(project: "Alpha", archived: true, ct: Ct);
        var project = await SingleProjectAsync();
        Assert.True(project.IsArchived);
        Assert.Equal("Work", project.AreaName);

        var refused = await Assert.ThrowsAsync<TaskFlowApiException>(
            () => Client.UpdateProjectAsync(project.Id, "Alpha", null, true, 999, Ct));
        Assert.Equal((HttpStatusCode.BadRequest, "Area not found."), (refused.Status, refused.Message));
        Assert.Equal(project.AreaId, (await SingleProjectAsync()).AreaId);

        Assert.Contains("Work - 1 project(s), including archived", await areas.ListAreas(Ct), StringComparison.Ordinal);
        var preview = await areas.DeleteArea("Work", ct: Ct);
        Assert.StartsWith("Nothing was deleted.", preview, StringComparison.Ordinal);
        Assert.Contains($"#{project.Id} Alpha (archived)", preview, StringComparison.Ordinal);
        Assert.Equal(2, (await Client.GetAreasAsync(Ct)).Count);

        await areas.DeleteArea("Work", newAreaName: newName, confirmed: true, ct: Ct);
        Assert.Equal(["Home", newName], (await Client.GetAreasAsync(Ct)).Select(a => a.Name));
        Assert.Equal(newName, (await SingleProjectAsync()).AreaName);

        await areas.DeleteArea(newName, moveToArea: "Home", confirmed: true, ct: Ct);
        Assert.Equal("Home", (await SingleProjectAsync()).AreaName);

        await areas.DeleteArea("Home", leaveProjectsWithoutArea: true, confirmed: true, ct: Ct);
        Assert.Null((await SingleProjectAsync()).AreaId);
        Assert.Empty(await Client.GetAreasAsync(Ct));
    }

    private async Task<ProjectDto> SingleProjectAsync() => Assert.Single(await Client.GetProjectsAsync(Ct));
}
