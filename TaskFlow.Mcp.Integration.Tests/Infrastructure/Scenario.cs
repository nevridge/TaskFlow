using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Integration.Tests.Infrastructure;

public sealed record ScenarioResult(
    DateOnly Today,
    TaskItemDto Parent,
    TaskItemDto Child,
    JournalEntryDto Entry,
    IReadOnlyList<TaskItemDto> Todos,
    LogEntryDto Log,
    NoteDto Note,
    IReadOnlyList<NoteDto> Notes);

/// <summary>
/// The journal flow an assistant session performs, run once against a real API: a parent with a planned subtask,
/// a log entry, a note, a block and an unblock. Shared by the value assertions and the field-name check.
/// </summary>
public static class Scenario
{
    public static async Task<ScenarioResult> RunAsync(McpHarness harness, CancellationToken ct)
    {
        var client = harness.Client;
        var offset = TestClock.OffsetMinutes;

        var parent = await client.CreateTaskAsync(
            new CreateTaskRequest("Scenario parent", "Parent task", "todo", "medium", TestClock.Today().AddDays(7), null, null, null, offset), ct);
        var child = await client.CreateTaskAsync(
            new CreateTaskRequest("Scenario child", null, "todo", "high", null, null, parent.Id, null, offset), ct);

        var today = TestClock.Today();
        child = await client.UpdateTaskAsync(
            child.Id,
            new UpdateTaskRequest(child.Title, child.Description, "todo", "high", child.DueDate, parent.Id, false, offset, null, today),
            ct);

        var entry = (await client.GetJournalEntriesAsync(ct)).Single(e => e.Date == today);
        var log = await client.AddLogEntryAsync(entry.Id, "Scenario log entry", child.Id, ct);
        var note = await client.AddJournalNoteAsync(entry.Id, "Scenario note", ct);

        // Read back after the writes so the nested log entries and todo ids are populated.
        entry = (await client.GetJournalEntriesAsync(ct)).Single(e => e.Date == today);
        var todos = await client.GetJournalTodosAsync(entry.Id, ct);
        var notes = await client.GetJournalNotesAsync(entry.Id, ct);

        // A parent's status follows its open subtasks, so block a standalone task instead.
        var standalone = await client.CreateTaskAsync(
            new CreateTaskRequest("Scenario standalone", null, "todo", "low", null, null, null, null, offset), ct);
        var blocked = await client.UpdateTaskAsync(
            standalone.Id,
            new UpdateTaskRequest(standalone.Title, null, "blocked", "low", null, null, false, offset, "Waiting on review"),
            ct);
        await client.UpdateTaskAsync(
            blocked.Id,
            new UpdateTaskRequest(blocked.Title, null, "todo", "low", null, null, false, offset),
            ct);
        await client.GetTasksAsync(ct);
        await client.GetTaskAsync(standalone.Id, ct);

        return new ScenarioResult(today, parent, child, entry, todos, log, note, notes);
    }
}
