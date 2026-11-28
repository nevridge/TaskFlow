using System.Net;
using System.Text.Json;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Goal <c>position</c> on create and update, and the journal summary append (#611), over the real HTTP pipeline.
/// </summary>
public sealed class GoalPositionAndAppendHttpTests : GoalsApiTestBase
{
    private async Task<List<int>> NextOrderAsync(int projectId) =>
        [.. (await GetJsonAsync($"/api/v1/Goals?projectId={projectId}&status=next")).EnumerateArray()
            .Select(g => g.GetProperty("id").GetInt32())];

    private async Task<int> CreateAtAsync(int projectId, string title, int? position)
    {
        var (status, json) = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId, title, position });
        Assert.Equal(HttpStatusCode.Created, status);
        return json.GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Create_WithPosition_InsertsFirstMiddleAndLast()
    {
        var project = await CreateProjectAsync();
        var a = await CreateGoalAsync(project, "a");
        var b = await CreateGoalAsync(project, "b");

        var first = await CreateAtAsync(project, "first", 1);
        var middle = await CreateAtAsync(project, "middle", 3);
        var last = await CreateAtAsync(project, "last", 5);

        Assert.Equal([first, a, middle, b, last], await NextOrderAsync(project));
    }

    [Fact]
    public async Task Create_WithoutPosition_StillAppends()
    {
        var project = await CreateProjectAsync();
        var a = await CreateGoalAsync(project, "a");
        var b = await CreateGoalAsync(project, "b");

        Assert.Equal([a, b], await NextOrderAsync(project));
    }

    [Fact]
    public async Task Create_WithAGapInDisplayOrder_YieldsACleanOrder()
    {
        var project = await CreateProjectAsync();
        var a = await CreateGoalAsync(project, "a");
        var b = await CreateGoalAsync(project, "b");
        var c = await CreateGoalAsync(project, "c");
        // Taking b out of Next leaves display orders 0 and 2.
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{b}", new { title = "b", status = "parked", parkedReason = "later" });

        var placed = await CreateAtAsync(project, "placed", 2);

        var orders = (await GetJsonAsync($"/api/v1/Goals?projectId={project}&status=next")).EnumerateArray()
            .Select(g => g.GetProperty("displayOrder").GetInt32());
        Assert.Equal([a, placed, c], await NextOrderAsync(project));
        Assert.Equal([0, 1, 2], orders);
    }

    [Fact]
    public async Task Update_ToNextWithPosition_PlacesIt_AndAGoalAlreadyNextCanTakeTheLastPlace()
    {
        var project = await CreateProjectAsync();
        var a = await CreateGoalAsync(project, "a");
        var b = await CreateGoalAsync(project, "b");
        var c = await CreateGoalAsync(project, "c");
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{c}", new { title = "c", status = "parked", parkedReason = "later" });

        var back = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{c}", new { title = "c", status = "next", position = 1 });
        Assert.Equal(HttpStatusCode.OK, back.Status);
        Assert.Equal([c, a, b], await NextOrderAsync(project));

        // c is already Next: the other Next goals number 2, so N + 1 is 3.
        var last = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{c}", new { title = "c", status = "next", position = 3 });
        Assert.Equal(HttpStatusCode.OK, last.Status);
        Assert.Equal([a, b, c], await NextOrderAsync(project));
    }

    [Fact]
    public async Task Update_WithoutPosition_KeepsItsPlace()
    {
        var project = await CreateProjectAsync();
        var a = await CreateGoalAsync(project, "a");
        var b = await CreateGoalAsync(project, "b");

        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{a}", new { title = "renamed", status = "next" });

        Assert.Equal([a, b], await NextOrderAsync(project));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(4)]
    public async Task Position_OutOfRange_IsRefusedWithTheRange_AndWritesNothing(int position)
    {
        var project = await CreateProjectAsync();
        var a = await CreateGoalAsync(project, "a");
        var b = await CreateGoalAsync(project, "b");

        var create = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId = project, title = "new", position });
        var update = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{b}", new { title = "changed", status = "next", position });

        Assert.Equal(HttpStatusCode.BadRequest, create.Status);
        Assert.Equal($"position {position} is out of range: use 1 to 3.", create.Body.GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, update.Status);
        // b is already Next, so the other Next goals number 1 and the range is 1 to 2.
        Assert.Equal($"position {position} is out of range: use 1 to 2.", update.Body.GetProperty("message").GetString());
        Assert.Equal([a, b], await NextOrderAsync(project));
        Assert.Equal("b", (await GetJsonAsync($"/api/v1/Goals/{b}")).GetProperty("title").GetString());
    }

    [Fact]
    public async Task Position_WithANonNextResult_IsRefusedWithTheStatus_AndWritesNothing()
    {
        var project = await CreateProjectAsync();
        var a = await CreateGoalAsync(project, "a");

        var create = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId = project, title = "n", status = "now", position = 1 });
        var update = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{a}", new { title = "a", status = "parked", parkedReason = "r", position = 1 });

        Assert.Equal(HttpStatusCode.BadRequest, create.Status);
        Assert.Equal("position only applies to a Next goal, and this one would be now.", create.Body.GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, update.Status);
        Assert.Equal("position only applies to a Next goal, and this one would be parked.", update.Body.GetProperty("message").GetString());
        Assert.Equal("Next", (await GetJsonAsync($"/api/v1/Goals/{a}")).GetProperty("status").GetString());
        Assert.Equal(1, (await GetJsonAsync($"/api/v1/Goals?projectId={project}")).GetArrayLength());
    }

    private async Task<int> CreateEntryAsync(string? summary = null)
    {
        var (status, json) = await SendAsync(
            HttpMethod.Post, "/api/v1/JournalEntries", new { title = "Day", date = "2031-05-05", summary });
        Assert.Equal(HttpStatusCode.Created, status);
        return json.GetProperty("id").GetInt32();
    }

    private Task<(HttpStatusCode Status, JsonElement Body)> AppendAsync(int id, string? text) =>
        SendAsync(HttpMethod.Post, $"/api/v1/JournalEntries/{id}/summary/append", new { text });

    private async Task<string?> SummaryAsync(int id) =>
        (await GetJsonAsync($"/api/v1/JournalEntries/{id}")).GetProperty("summary").GetString();

    [Fact]
    public async Task Append_ToANullOrBlankSummary_BecomesTheTrimmedText()
    {
        var empty = await CreateEntryAsync();

        var (status, body) = await AppendAsync(empty, "  first  ");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("first", body.GetProperty("summary").GetString());
        Assert.Equal("first", await SummaryAsync(empty));
    }

    [Fact]
    public async Task Append_ToAnExistingSummary_TrimsItsTrailingWhitespaceAndJoinsWithABlankLine()
    {
        var id = await CreateEntryAsync("Morning notes \r\n\t ");

        var (status, body) = await AppendAsync(id, "Afternoon");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("Morning notes\n\nAfternoon", body.GetProperty("summary").GetString());
    }

    [Fact]
    public async Task Append_BlankText_Is400()
    {
        var id = await CreateEntryAsync("keep");

        var blank = await AppendAsync(id, "  \n ");
        var missing = await AppendAsync(id, null);

        Assert.Equal(HttpStatusCode.BadRequest, blank.Status);
        Assert.Equal(HttpStatusCode.BadRequest, missing.Status);
        Assert.Equal("keep", await SummaryAsync(id));
    }

    [Fact]
    public async Task Append_UnknownEntry_Is404()
    {
        var (status, _) = await AppendAsync(9999, "x");

        Assert.Equal(HttpStatusCode.NotFound, status);
    }

    [Fact]
    public async Task Append_OverTheLimit_Is400WithTheNumbers_AndSavesNothing()
    {
        var existing = new string('a', 9990);
        var id = await CreateEntryAsync(existing);

        var (status, body) = await AppendAsync(id, new string('b', 20));

        Assert.Equal(HttpStatusCode.BadRequest, status);
        var message = body.GetProperty("message").GetString()!;
        Assert.Contains("10012", message);
        Assert.Contains("10000", message);
        Assert.Contains("9990", message);
        Assert.Contains("20", message);
        Assert.Equal(existing, await SummaryAsync(id));
    }

    [Fact]
    public async Task Append_ExactlyAtTheLimit_Succeeds()
    {
        var id = await CreateEntryAsync(new string('a', 9990));

        var (status, _) = await AppendAsync(id, new string('b', 8));

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(10000, (await SummaryAsync(id))!.Length);
    }

    [Fact]
    public async Task Append_ConcurrentRequests_AllSurvive()
    {
        var id = await CreateEntryAsync();
        var texts = Enumerable.Range(1, 8).Select(i => $"note-{i}").ToList();

        var results = await Task.WhenAll(texts.Select(t => Task.Run(() => AppendAsync(id, t), Ct)));

        Assert.All(results, r => Assert.Equal(HttpStatusCode.OK, r.Status));
        var summary = (await SummaryAsync(id))!;
        Assert.All(texts, t => Assert.Contains(t, summary));
        Assert.Equal(texts.Count, summary.Split("\n\n").Length);
    }

    [Fact]
    public async Task Put_StillOverwritesTheSummary()
    {
        var id = await CreateEntryAsync("old");

        var (status, _) = await SendAsync(HttpMethod.Put, $"/api/v1/JournalEntries/{id}", new { title = "Day", summary = "new" });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("new", await SummaryAsync(id));
    }
}
