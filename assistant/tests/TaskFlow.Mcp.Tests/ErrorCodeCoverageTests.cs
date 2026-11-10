using System.Net;
using System.Reflection;
using AwesomeAssertions;
using TaskFlow.Contracts;
using TaskFlow.Mcp.Api;
using TaskFlow.Mcp.Tools;

namespace TaskFlow.Mcp.Tests;

/// <summary>
/// Fails when an API error code is added to <see cref="ErrorCodes"/> without either a ToolGuard
/// guidance string or an explicit, justified entry in <see cref="NoMessageNeeded"/>.
/// </summary>
public class ErrorCodeCoverageTests
{
    private static readonly Dictionary<string, string> NoMessageNeeded = new()
    {
        [ErrorCodes.CreateBlockedNotAllowed] =
            "The API message already says to create the task first, then block it, and create_tasks also rejects status=blocked client-side before calling the API.",
        [ErrorCodes.JournalAssignmentConflict] =
            "It is a 409 race (another request planned the task between check and save), and ToolGuard guides only 422s; widening that is out of scope. The raw message still reaches the model through ToolGuard.RunAsync.",
    };

    private static IEnumerable<string> AllCodes() =>
        typeof(ErrorCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && !f.IsInitOnly && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!);

    private static TaskFlowApiException Unprocessable(string code) =>
        new(HttpStatusCode.UnprocessableEntity, code, $"Nope. [{code}]");

    private static bool IsMapped(string code)
    {
        var ex = Unprocessable(code);
        return ToolGuard.WithGuidance(ex).Length > ex.Message.Length;
    }

    [Fact]
    public void EveryErrorCode_IsMappedOrExplicitlyListed()
    {
        AllCodes().Should().NotBeEmpty();

        var missing = AllCodes().Where(c => !IsMapped(c) && !NoMessageNeeded.ContainsKey(c)).ToList();

        missing.Should().BeEmpty("every ErrorCodes value needs a ToolGuard guidance string or a NoMessageNeeded entry; missing: {0}", string.Join(", ", missing));
    }

    [Fact]
    public void NoMessageNeededList_IsHonest()
    {
        var all = AllCodes().ToHashSet();

        NoMessageNeeded.Keys.Should().OnlyContain(k => all.Contains(k), "every listed code must exist in ErrorCodes");
        NoMessageNeeded.Keys.Where(IsMapped).Should().BeEmpty("a code with guidance must not also be listed as needing none");
        NoMessageNeeded.Values.Should().OnlyContain(r => r.Length >= 20);
    }

    [Theory]
    [InlineData(ErrorCodes.ProjectNotFound, "list_projects")]
    [InlineData(ErrorCodes.ProjectNotFound, "project")]
    [InlineData(ErrorCodes.ReopenPastDayNotAllowed, "complete=false")]
    [InlineData(ErrorCodes.ReopenPastDayNotAllowed, "create_tasks")]
    [InlineData(ErrorCodes.ParentNotFound, "parentTaskId")]
    [InlineData(ErrorCodes.ParentNotFound, "list_tasks")]
    [InlineData(ErrorCodes.ParentSelfNotAllowed, "parentTaskId")]
    [InlineData(ErrorCodes.ParentDepthNotAllowed, "get_task")]
    [InlineData(ErrorCodes.ParentDepthNotAllowed, "parentTaskId")]
    [InlineData(ErrorCodes.ParentCompleteBlockedByChildren, "complete=true")]
    [InlineData(ErrorCodes.ParentCompleteBlockedByChildren, "update_tasks")]
    [InlineData(ErrorCodes.ParentDeleteBlockedByChildren, "parentTaskId=0")]
    [InlineData(ErrorCodes.ParentDeleteBlockedByChildren, "delete_task")]
    [InlineData(ErrorCodes.AssignmentPastDayNotAllowed, "set_journal_todos")]
    [InlineData(ErrorCodes.AssignmentPastDayNotAllowed, "pass date as")]
    public void WithGuidance_ForTheNewMappings_ContainsTheExpectedToken(string code, string token)
    {
        var lines = ToolGuard.WithGuidance(Unprocessable(code)).Split('\n');

        lines.Should().HaveCount(2);
        lines[1].Should().Contain(token);
    }

    [Fact]
    public void EveryGuidance_NamesAToolOrParameter_AndHasNoTaskId()
    {
        var names = new[] { "list_projects", "list_tasks", "get_task", "create_tasks", "update_task", "update_tasks", "delete_task", "set_journal_todos", "project", "parentTaskId", "journalDate", "blockedReason", "status=", "complete=", "date" };

        foreach (var code in AllCodes().Where(IsMapped))
        {
            var guidance = ToolGuard.WithGuidance(Unprocessable(code)).Split('\n')[1];

            names.Any(guidance.Contains).Should().BeTrue($"{code} guidance must name a tool or parameter");
            guidance.Replace("parentTaskId=0", "parentTaskId").Should().NotMatchRegex(@"\b\d+\b", $"{code} guidance must not contain a task id");
            guidance.Should().NotContain("#", $"{code} guidance must not contain a task id");
            guidance.Should().NotContain("\n");
        }
    }

    [Fact]
    public void NonUnprocessableStatus_WithAMappedCode_PassesThrough()
    {
        var ex = new TaskFlowApiException(HttpStatusCode.Conflict, ErrorCodes.StartNotAllowed, "raw");

        ToolGuard.WithGuidance(ex).Should().Be("raw");
    }

    [Fact]
    public void NullCode_PassesThrough()
    {
        var ex = new TaskFlowApiException(HttpStatusCode.UnprocessableEntity, null, "raw");

        ToolGuard.WithGuidance(ex).Should().Be("raw");
    }

    [Fact]
    public void UnknownCode_PassesThrough()
    {
        var ex = new TaskFlowApiException(HttpStatusCode.UnprocessableEntity, "TASK_UNKNOWN", "raw");

        ToolGuard.WithGuidance(ex).Should().Be("raw");
    }

    [Fact]
    public void UnprocessableNoMessageNeededCode_ReturnsTheExactMessage()
    {
        foreach (var code in NoMessageNeeded.Keys)
        {
            var ex = Unprocessable(code);

            ToolGuard.WithGuidance(ex).Should().Be(ex.Message);
        }
    }
}
