using System.Net;
using System.Text.Json;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>Input rules and status codes of the goal endpoints, including which check wins.</summary>
public sealed class GoalsControllerV1Tests : GoalsApiTestBase
{
    private static object Edit(string title, string? status, string? parkedReason = null) =>
        new { title, status, parkedReason };

    [Fact]
    public async Task Create_TrimsTheTitle_AndDefaultsToNext()
    {
        var projectId = await CreateProjectAsync();

        var (status, goal) = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId, title = "  Ship  " });

        Assert.Equal(HttpStatusCode.Created, status);
        Assert.Equal("Ship", goal.GetProperty("title").GetString());
        Assert.Equal("Next", goal.GetProperty("status").GetString());
    }

    [Theory]
    [InlineData("   ", "next")]
    [InlineData("ok", "parked")]
    [InlineData("ok", "done")]
    [InlineData("ok", "dropped")]
    public async Task Create_RejectsABlankTitleOrAStartingStatusOtherThanNextAndNow(string title, string goalStatus)
    {
        var projectId = await CreateProjectAsync();

        var (status, _) = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId, title, status = goalStatus });

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Empty((await GetJsonAsync("/api/v1/Goals")).EnumerateArray());
    }

    [Fact]
    public async Task Create_RejectsAnOverlongTitle_AnUnknownProject_AndASecondNow()
    {
        var projectId = await CreateProjectAsync();
        await CreateGoalAsync(projectId, "now", "now");

        var overlong = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId, title = new string('a', 101) });
        var unknown = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId = 999, title = "x" });
        var second = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId, title = "x", status = "now" });

        Assert.Equal(HttpStatusCode.BadRequest, overlong.Status);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.Status);
        Assert.NotEmpty(unknown.Body.GetProperty("message").GetString()!);
        Assert.Equal(HttpStatusCode.Conflict, second.Status);
        Assert.NotEmpty(second.Body.GetProperty("message").GetString()!);
    }

    [Fact]
    public async Task Update_ChecksExistenceThenFieldsThenTheNowConflict()
    {
        var projectId = await CreateProjectAsync();
        await CreateGoalAsync(projectId, "now", "now");
        var next = await CreateGoalAsync(projectId, "next");

        var missing = await SendAsync(HttpMethod.Put, "/api/v1/Goals/999", Edit("", null));
        var noStatus = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{next}", Edit("x", null));
        var invalidBeforeConflict = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{next}", Edit("", "now"));
        var noReason = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{next}", Edit("x", "parked", "  "));
        var conflict = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{next}", Edit("x", "now"));

        Assert.Equal(HttpStatusCode.NotFound, missing.Status);
        Assert.NotEmpty(missing.Body.GetProperty("message").GetString()!);
        Assert.Equal(HttpStatusCode.BadRequest, noStatus.Status);
        Assert.Equal(HttpStatusCode.BadRequest, invalidBeforeConflict.Status);
        Assert.Equal(HttpStatusCode.BadRequest, noReason.Status);
        Assert.Equal(HttpStatusCode.Conflict, conflict.Status);
        Assert.Equal("next", (await GetJsonAsync($"/api/v1/Goals/{next}")).GetProperty("title").GetString());
    }

    [Fact]
    public async Task Update_TrimsTheParkedReason_AndIgnoresItForOtherStatuses()
    {
        var projectId = await CreateProjectAsync();
        var id = await CreateGoalAsync(projectId, "g");

        var parked = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{id}", Edit("g", "parked", "  later  "));
        var next = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{id}", Edit("g", "next", new string('a', 300)));

        Assert.Equal("later", parked.Body.GetProperty("parkedReason").GetString());
        Assert.Equal(HttpStatusCode.OK, next.Status);
        Assert.Equal(JsonValueKind.Null, next.Body.GetProperty("parkedReason").ValueKind);
    }

    [Fact]
    public async Task UnknownIds_Return404_AndAClosedGoalCannotBeSwapped()
    {
        var projectId = await CreateProjectAsync();
        var done = await CreateGoalAsync(projectId, "done");
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{done}", Edit("done", "done"));

        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(HttpMethod.Get, "/api/v1/Goals/999")).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(HttpMethod.Delete, "/api/v1/Goals/999")).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(HttpMethod.Post, "/api/v1/Goals/999/swap-now")).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Post, $"/api/v1/Goals/{done}/swap-now")).Status);
    }

    [Fact]
    public async Task TaskAssignment_MapsEachRefusalToItsStatusCode()
    {
        var projectId = await CreateProjectAsync();
        var goal = await CreateGoalAsync(projectId, "g");
        var task = await CreateTaskAsync(projectId);
        var child = await CreateTaskAsync(projectId, parentTaskItemId: task);
        var elsewhere = await CreateTaskAsync(await CreateProjectAsync("Beta"));
        var url = $"/api/v1/Goals/{goal}/tasks";

        async Task<HttpStatusCode> Assign(int taskItemId) => (await SendAsync(HttpMethod.Post, url, new { taskItemId })).Status;

        Assert.Equal(HttpStatusCode.BadRequest, await Assign(0));
        Assert.Equal(HttpStatusCode.NotFound, await Assign(999));
        Assert.Equal(HttpStatusCode.BadRequest, await Assign(child));
        Assert.Equal(HttpStatusCode.BadRequest, await Assign(elsewhere));
        Assert.Equal(HttpStatusCode.NoContent, await Assign(task));
        Assert.Equal(HttpStatusCode.Conflict, await Assign(task));
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Delete, $"{url}/{child}")).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(HttpMethod.Delete, $"{url}/{elsewhere}")).Status);
        Assert.Equal(HttpStatusCode.NoContent, (await SendAsync(HttpMethod.Delete, $"{url}/{task}")).Status);
    }
}
