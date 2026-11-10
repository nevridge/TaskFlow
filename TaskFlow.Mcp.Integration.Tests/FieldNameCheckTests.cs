using System.Net;
using System.Text.Json;
using TaskFlow.Mcp.Api;
using TaskFlow.Mcp.Integration.Tests.Infrastructure;

namespace TaskFlow.Mcp.Integration.Tests;

public sealed class FieldNameCheckTests : IntegrationTestBase
{
    [Fact]
    public async Task EndToEnd_AllClientModelFieldsAppearInRealResponses()
    {
        // Catches an API field rename or removal that the client's non-required records would swallow as defaults.
        await Scenario.RunAsync(Harness, Ct);

        var missing = FieldCoverage.FindMissing(Harness.Recorder.Calls);

        Assert.True(
            missing.Count == 0,
            "The client models expect fields the real API never returned: " + string.Join(", ", missing));
    }
}

public sealed class FieldCoverageTests
{
    [Fact]
    public void Passes_WhenResponsesCarryEveryFieldPlusExtras()
    {
        var missing = FieldCoverage.FindMissing(CompleteCalls(extraProperty: true));

        Assert.Empty(missing);
    }

    [Fact]
    public void Fails_WhenAFieldIsMissing()
    {
        var missing = FieldCoverage.FindMissing(CompleteCalls(drop: "title"));

        Assert.Contains("TaskItemDto.title", missing);
        Assert.Contains("JournalEntryDto.title", missing);
    }

    [Fact]
    public void Fails_WhenAFieldIsRenamed()
    {
        var missing = FieldCoverage.FindMissing(CompleteCalls(rename: ("content", "text")));

        Assert.Contains("NoteDto.content", missing);
        Assert.Contains("LogEntryDto.content", missing);
    }

    [Fact]
    public void Fails_ForModelsNeverObserved()
    {
        var missing = FieldCoverage.FindMissing([]);

        Assert.Contains("NoteDto.id", missing);
        Assert.Contains("LogEntryDto.linkedTaskDeleted", missing);
    }

    private static List<RecordedCall> CompleteCalls(bool extraProperty = false, string? drop = null, (string From, string To)? rename = null)
    {
        string Body(Type model, string? nestedLogs = null)
        {
            var fields = new Dictionary<string, object?>();
            foreach (var name in FieldCoverage.ExpectedNames(model))
            {
                if (name == drop)
                {
                    continue;
                }

                fields[rename is { } r && name == r.From ? r.To : name] = name == "logEntries" ? JsonDocument.Parse(nestedLogs ?? "[]").RootElement : null;
            }

            if (extraProperty)
            {
                fields["completedAt"] = null;
                fields["movedCount"] = 0;
            }

            return JsonSerializer.Serialize(fields);
        }

        var log = Body(typeof(LogEntryDto));
        return
        [
            new("GET", "/api/v1/TaskItems", HttpStatusCode.OK, "1.0", "[" + Body(typeof(TaskItemDto)) + "]"),
            new("GET", "/api/v1/JournalEntries", HttpStatusCode.OK, "1.0", "[" + Body(typeof(JournalEntryDto), "[" + log + "]") + "]"),
            new("POST", "/api/v1/JournalEntries/7/logs", HttpStatusCode.OK, "1.0", log),
            new("GET", "/api/v1/JournalEntries/7/notes", HttpStatusCode.OK, "1.0", "[" + Body(typeof(NoteDto)) + "]"),
        ];
    }
}
