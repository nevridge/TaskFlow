using System.ComponentModel;
using System.Net;
using System.Reflection;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using TaskFlow.Mcp.Api;
using TaskFlow.Mcp.Extensions;
using TaskFlow.Mcp.Tools;

namespace TaskFlow.Mcp.Tests;

public class ApiClientErrorTests
{
    [Fact]
    public async Task CodeAndMessage_AreExtracted_FromUnprocessableEntity()
    {
        var handler = new StubHandler().Post("TaskItems", new { code = "TASK_PARENT_NOT_FOUND", message = "The selected parent task was not found." }, HttpStatusCode.UnprocessableEntity);
        var api = Fixtures.Client(handler);

        var act = () => api.CreateTaskAsync(new CreateTaskRequest("t", null, "todo", "low", null, null, 9, null, 0), CancellationToken.None);

        var ex = (await act.Should().ThrowAsync<TaskFlowApiException>()).Which;
        ex.Status.Should().Be(HttpStatusCode.UnprocessableEntity);
        ex.Code.Should().Be("TASK_PARENT_NOT_FOUND");
        ex.Message.Should().Be("The selected parent task was not found. [TASK_PARENT_NOT_FOUND]");
    }

    [Fact]
    public async Task ValidationArray_IsFlattened()
    {
        var body = """[{"propertyName":"Title","errorMessage":"Title is required."},{"propertyName":"Status","errorMessage":"Invalid status."}]""";
        var handler = new StubHandler().Post("TaskItems", body, HttpStatusCode.BadRequest);

        var act = () => Fixtures.Client(handler).CreateTaskAsync(new CreateTaskRequest("", null, "todo", "low", null, null, null, null, 0), CancellationToken.None);

        (await act.Should().ThrowAsync<TaskFlowApiException>())
            .Which.Message.Should().Be("Validation failed - Title: Title is required.; Status: Invalid status.");
    }

    [Fact]
    public async Task ProblemDetailsErrors_AreFlattened()
    {
        var body = """{"title":"One or more validation errors occurred.","errors":{"createDto":["The createDto field is required."]}}""";
        var handler = new StubHandler().Post("TaskItems", body, HttpStatusCode.BadRequest);

        var act = () => Fixtures.Client(handler).CreateTaskAsync(new CreateTaskRequest("", null, "todo", "low", null, null, null, null, 0), CancellationToken.None);

        (await act.Should().ThrowAsync<TaskFlowApiException>())
            .Which.Message.Should().Be("Validation failed - createDto: The createDto field is required.");
    }

    [Fact]
    public async Task ProblemDetailsErrorsMap_KeepsRootCode()
    {
        var body = """{"title":"Validation","errors":{"blockedReason":["Too long."]},"code":"TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS"}""";
        var handler = new StubHandler().Post("TaskItems", body, HttpStatusCode.UnprocessableEntity);

        var act = () => Fixtures.Client(handler).CreateTaskAsync(new CreateTaskRequest("t", null, "todo", "low", null, null, null, null, 0), CancellationToken.None);

        var ex = (await act.Should().ThrowAsync<TaskFlowApiException>()).Which;
        ex.Code.Should().Be("TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS");
        ex.Message.Should().Be("Validation failed - blockedReason: Too long. [TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS]");
    }

    [Fact]
    public void TaskItemDto_Deserializes_BlockedFields_WhenPresent()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(
            Fixtures.Task(1, status: "Blocked", blockedReason: "Waiting on vendor", blockedAt: "2026-10-05T10:00:00Z", previousStatus: "Todo"),
            TaskFlowApiClient.Json);

        var task = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(json, TaskFlowApiClient.Json)!;

        task.IsBlocked.Should().BeTrue();
        task.BlockedReason.Should().Be("Waiting on vendor");
        task.BlockedAt.Should().Be(new DateTime(2026, 10, 5, 10, 0, 0, DateTimeKind.Utc));
        task.BlockedAt!.Value.Kind.Should().Be(DateTimeKind.Utc);
        task.PreviousStatus.Should().Be("Todo");
    }

    [Fact]
    public void TaskItemDto_Deserializes_BlockedFieldsAsNull_WhenAbsent()
    {
        var task = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(
            """{"id":1,"title":"t","status":"Todo","priority":"Low","childTaskCount":0,"moveCount":0,"daysTagged":0}""",
            TaskFlowApiClient.Json)!;

        task.BlockedReason.Should().BeNull();
        task.BlockedAt.Should().BeNull();
        task.PreviousStatus.Should().BeNull();
        task.IsBlocked.Should().BeFalse();
    }

    [Theory]
    [InlineData("Completed", true)]
    [InlineData("COMPLETED", true)]
    [InlineData("Todo", false)]
    [InlineData("InProgress", false)]
    [InlineData("Blocked", false)]
    public void TaskItemDto_IsDone_IsTrueOnlyForCompletedStatus(string status, bool expected)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(Fixtures.Task(1, status: status), TaskFlowApiClient.Json);

        var task = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(json, TaskFlowApiClient.Json)!;

        task.IsDone.Should().Be(expected);
    }

    [Theory]
    [InlineData("true", "Todo", false)]
    [InlineData("false", "Completed", true)]
    public void TaskItemDto_Deserializes_IgnoringALeftoverIsCompleteField(string isComplete, string status, bool expectedDone)
    {
        var json = $$"""{"id":1,"title":"t","isComplete":{{isComplete}},"status":"{{status}}","priority":"Low","childTaskCount":0,"moveCount":0,"daysTagged":0}""";

        var task = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(json, TaskFlowApiClient.Json)!;

        task.Status.Should().Be(status);
        task.IsDone.Should().Be(expectedDone);
    }

    [Fact]
    public void TaskItemDto_Deserializes_StartedAt_WhenPresent()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(
            Fixtures.Task(1, status: "InProgress", startedAt: "2026-10-06T08:30:00Z"),
            TaskFlowApiClient.Json);

        var task = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(json, TaskFlowApiClient.Json)!;

        task.StartedAt.Should().Be(new DateTime(2026, 10, 6, 8, 30, 0, DateTimeKind.Utc));
        task.StartedAt!.Value.Kind.Should().Be(DateTimeKind.Utc);
    }

    [Fact]
    public void TaskItemDto_Deserializes_StartedAtAsNull_WhenAbsent()
    {
        var task = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(
            """{"id":1,"title":"t","status":"Todo","priority":"Low","childTaskCount":0,"moveCount":0,"daysTagged":0}""",
            TaskFlowApiClient.Json)!;

        task.StartedAt.Should().BeNull();
        FluentActions.Invoking(() => Formatting.Task(task, Fixtures.Today, detailed: true)).Should().NotThrow();
    }

    [Fact]
    public void TaskItemDto_Deserializes_DateOnlyDueDate()
    {
        var task = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(
            """{"id":1,"title":"t","dueDate":"2026-10-12","status":"Todo","priority":"Low","childTaskCount":0,"moveCount":0,"daysTagged":0}""",
            TaskFlowApiClient.Json)!;

        task.DueDate.Should().Be(new DateOnly(2026, 10, 12));
    }

    [Fact]
    public void TaskItemDto_Deserializes_NullDueDateAsNull()
    {
        var task = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(
            """{"id":1,"title":"t","dueDate":null,"status":"Todo","priority":"Low","childTaskCount":0,"moveCount":0,"daysTagged":0}""",
            TaskFlowApiClient.Json)!;

        task.DueDate.Should().BeNull();
    }

    [Fact]
    public void TaskItemDto_DateTimeDueDate_ThrowsJsonException()
    {
        Action act = () => System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(
            """{"id":1,"title":"t","dueDate":"2026-10-12T00:00:00Z","status":"Todo","priority":"Low","childTaskCount":0,"moveCount":0,"daysTagged":0}""",
            TaskFlowApiClient.Json);

        act.Should().Throw<System.Text.Json.JsonException>();
    }

    [Fact]
    public void ProjectDto_Deserializes_BlockedCount_DefaultingToZero()
    {
        var with = System.Text.Json.JsonSerializer.Deserialize<ProjectDto>(
            System.Text.Json.JsonSerializer.Serialize(Fixtures.Project(1, "A", open: 5, blockedCount: 2), TaskFlowApiClient.Json), TaskFlowApiClient.Json)!;
        var without = System.Text.Json.JsonSerializer.Deserialize<ProjectDto>(
            """{"id":1,"name":"A","isArchived":false,"createdAt":"2026-10-01T00:00:00Z","openTaskCount":1,"completedTaskCount":0}""", TaskFlowApiClient.Json)!;

        with.BlockedCount.Should().Be(2);
        without.BlockedCount.Should().Be(0);
    }

    [Fact]
    public async Task NotFound_HasFriendlyMessage_EvenWithProblemDetailsBody()
    {
        var api = Fixtures.Client(new StubHandler().On(HttpMethod.Get, "TaskItems/9", """{"title":"Not Found","status":404}""", HttpStatusCode.NotFound));

        var act = () => api.GetTaskAsync(9, CancellationToken.None);

        (await act.Should().ThrowAsync<TaskFlowApiException>())
            .Which.Message.Should().Be("Not found (GET TaskItems/9): the item does not exist.");
    }

    [Fact]
    public async Task ServerErrors_DoNotLeakBodies()
    {
        var handler = new StubHandler().Put("JournalEntries/1", "System.Exception: secret stack trace", HttpStatusCode.InternalServerError);

        var act = () => Fixtures.Client(handler).UpdateJournalEntryAsync(1, "t", "s", CancellationToken.None);

        var message = (await act.Should().ThrowAsync<TaskFlowApiException>()).Which.Message;
        message.Should().Contain("500").And.Contain("PUT JournalEntries/1").And.NotContain("secret");
    }

    [Fact]
    public async Task UnparseableErrorBody_FallsBackToStatusLine()
    {
        var act = () => Fixtures.Client(new StubHandler().On(HttpMethod.Get, "Projects", "<html>bad</html>", HttpStatusCode.ServiceUnavailable)).GetProjectsAsync(CancellationToken.None);

        (await act.Should().ThrowAsync<TaskFlowApiException>()).Which.Message.Should().Contain("503");
    }
}

public class ServiceRegistrationTests
{
    [Theory]
    [InlineData(null, "http://localhost:8081")]
    [InlineData("", "http://localhost:8081")]
    [InlineData("  ", "http://localhost:8081")]
    [InlineData("http://example.test:9000/", "http://example.test:9000")]
    [InlineData("${user_config.api_url}", "http://localhost:8081")]
    [InlineData("ftp://example.test", "http://localhost:8081")]
    [InlineData("localhost:8081", "http://localhost:8081")]
    public void BaseUrl_UsesDefaultOrTrimmedValue(string? configured, string expected)
    {
        using var provider = new ServiceCollection().AddTaskFlowApi(configured).BuildServiceProvider();

        provider.GetRequiredService<TaskFlowApiClient>().BaseUrl.Should().Be(expected);
    }
}

public class InputParsingTests
{
    private static readonly DateOnly Today = new(2026, 10, 9);

    [Theory]
    [InlineData("2026-12-31", "2026-12-31")]
    [InlineData("today", "2026-10-09")]
    [InlineData("Tomorrow", "2026-10-10")]
    [InlineData(" yesterday ", "2026-10-08")]
    public void ParseDate_AcceptsIsoAndKeywords(string input, string expected) =>
        InputParsing.ParseDate(input, Today, "d").Should().Be(DateOnly.Parse(expected));

    [Theory]
    [InlineData("12/31/2026")]
    [InlineData("next friday")]
    public void ParseDate_RejectsOtherFormats_WithAHint(string input) =>
        FluentActions.Invoking(() => InputParsing.ParseDate(input, Today, "dueDate"))
            .Should().Throw<McpException>().WithMessage("*dueDate*yyyy-MM-dd*");

    [Theory]
    [InlineData("2026-10-09", "2026-10-09")]
    [InlineData(" 2026-10-09 ", "2026-10-09")]
    [InlineData("2026-09-01", "2026-09-01")]
    [InlineData("Today", "2026-10-09")]
    [InlineData("today", "2026-10-09")]
    [InlineData("TOMORROW", "2026-10-10")]
    [InlineData("tomorrow", "2026-10-10")]
    public void ParsePlanDay_AcceptsTodayTomorrowAndIso(string input, string expected) =>
        InputParsing.ParsePlanDay(input, Today, "journalDate").Should().Be(DateOnly.Parse(expected));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ParsePlanDay_NullOrBlank_IsAbsent(string? input) =>
        InputParsing.ParsePlanDay(input, Today, "journalDate").Should().BeNull();

    [Theory]
    [InlineData("yesterday")]
    [InlineData("none")]
    [InlineData("2026-1-5")]
    [InlineData("26-10-09")]
    [InlineData("2026/10/09")]
    [InlineData("20261009")]
    [InlineData("2026-10-09T00:00:00")]
    [InlineData("2026-02-30")]
    public void ParsePlanDay_RejectsEverythingElse_WithTheAcceptedForms(string input) =>
        FluentActions.Invoking(() => InputParsing.ParsePlanDay(input, Today, "journalDate"))
            .Should().Throw<McpException>()
            .WithMessage($"journalDate '{input}' is not valid. Use today, tomorrow, or yyyy-MM-dd (today or later), e.g. 2026-10-10.*set_journal_todos*");

    [Fact]
    public void ParseDateOrToday_DefaultsToToday() =>
        InputParsing.ParseDateOrToday(null, Today, "d").Should().Be(Today);

    [Fact]
    public void Normalize_RejectsUnknownValues_ListingAllowed()
    {
        FluentActions.Invoking(() => InputParsing.NormalizePriority("urgent")).Should().Throw<McpException>().WithMessage("*low, medium, high*");
        FluentActions.Invoking(() => InputParsing.NormalizeStatus("done")).Should().Throw<McpException>().WithMessage("*Allowed values: draft, todo, inprogress, blocked, completed.");
        InputParsing.NormalizePriority(" HIGH ").Should().Be("high");
    }

    [Fact]
    public void NormalizeStatus_AcceptsBlocked_CaseInsensitively() =>
        InputParsing.NormalizeStatus(" BLOCKED ").Should().Be("blocked");

    [Theory]
    [InlineData("inprogress")]
    [InlineData("InProgress")]
    [InlineData(" INPROGRESS ")]
    public void NormalizeStatus_AcceptsInProgress_AnyCasing(string input) =>
        InputParsing.NormalizeStatus(input).Should().Be("inprogress");

    [Fact]
    public void TimeHelpers_UseTheLocalTimeZone()
    {
        var time = Fixtures.Time();

        InputParsing.Today(time).Should().Be(Today);
        InputParsing.LocalNow(time).OffsetMinutes.Should().Be(-420);
    }

    [Fact]
    public void CountingTimeProvider_OneGetLocalNow_IsOneUtcRead()
    {
        var provider = new CountingTimeProvider();

        provider.GetLocalNow();

        provider.UtcReads.Should().Be(1);
    }

    [Fact]
    public void LocalNow_ReturnsDateAndOffset_FromOneRead()
    {
        var time = Fixtures.Time(new DateTimeOffset(2026, 10, 10, 2, 0, 0, TimeSpan.Zero), -300);

        var (today, offset) = InputParsing.LocalNow(time);

        today.Should().Be(Today);
        offset.Should().Be(-300);
    }

    [Fact]
    public void Today_IsTheLocalDate_NotTheUtcDate()
    {
        var time = Fixtures.Time();
        time.SetUtcNow(new DateTimeOffset(2026, 10, 10, 3, 0, 0, TimeSpan.Zero)); // still Oct 9 at UTC-7

        InputParsing.Today(time).Should().Be(Today);
    }
}

public class JournalDateSerializationTests
{
    [Fact]
    public void UpdateTaskRequest_SerializesJournalDate_LikeCreateTaskRequest()
    {
        var day = new DateOnly(2026, 10, 10);
        var create = new CreateTaskRequest("t", null, "todo", "low", null, day, null, null, 0);
        var update = new UpdateTaskRequest("t", null, "todo", "low", null, null, false, 0, JournalDate: day);

        var created = System.Text.Json.JsonSerializer.SerializeToElement(create, TaskFlowApiClient.Json);
        var updated = System.Text.Json.JsonSerializer.SerializeToElement(update, TaskFlowApiClient.Json);

        updated.GetProperty("journalDate").GetString().Should().Be("2026-10-10").And.Be(created.GetProperty("journalDate").GetString());
    }

    [Fact]
    public void UpdateTaskRequest_WithoutJournalDate_SendsAnExplicitNull()
    {
        var update = new UpdateTaskRequest("t", null, "todo", "low", null, null, false, 0);

        var json = System.Text.Json.JsonSerializer.SerializeToElement(update, TaskFlowApiClient.Json);

        json.TryGetProperty("journalDate", out var property).Should().BeTrue();
        property.ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
    }
}

public class ProjectResolverTests
{
    private static readonly IReadOnlyList<ProjectDto> Projects =
    [
        new(1, "Alpha Launch", null, false, DateTime.UtcNow, null, 0, 0),
        new(2, "Beta", null, false, DateTime.UtcNow, null, 0, 0),
        new(3, "Alpha Support", null, false, DateTime.UtcNow, null, 0, 0),
    ];

    [Theory]
    [InlineData("2", 2)]
    [InlineData("beta", 2)]
    [InlineData("BETA", 2)]
    [InlineData("launch", 1)]
    [InlineData("alpha launch", 1)]
    public void Resolves_ById_ExactName_OrUniquePartial(string input, int expectedId) =>
        ProjectResolver.Resolve(Projects, input).Id.Should().Be(expectedId);

    [Fact]
    public void Ambiguous_PartialMatch_Throws_ListingMatches() =>
        FluentActions.Invoking(() => ProjectResolver.Resolve(Projects, "alpha"))
            .Should().Throw<McpException>().WithMessage("*ambiguous*Alpha Launch*Alpha Support*");

    [Fact]
    public void Unknown_Throws_ListingAvailableProjects() =>
        FluentActions.Invoking(() => ProjectResolver.Resolve(Projects, "nope"))
            .Should().Throw<McpException>().WithMessage("*No project matches 'nope'*'Beta' (#2)*");

    [Fact]
    public void NoProjects_Throws_SuggestingCreation() =>
        FluentActions.Invoking(() => ProjectResolver.Resolve([], "x"))
            .Should().Throw<McpException>().WithMessage("*save_project*");
}

public class ToolGuardTests
{
    [Fact]
    public async Task ApiErrors_BecomeMcpExceptions_WithTheApiMessage()
    {
        var api = Fixtures.Client(new StubHandler());

        var act = () => ToolGuard.RunAsync(api, CancellationToken.None, () => throw new TaskFlowApiException(HttpStatusCode.Conflict, null, "already exists"));

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Be("already exists");
    }

    [Theory]
    [InlineData("TASK_BLOCK_DRAFT_NOT_ALLOWED", "Make the task Todo first (status=todo), then block it.")]
    [InlineData("TASK_BLOCK_COMPLETED_NOT_ALLOWED", "Reopen the task first (complete=false), then block it.")]
    [InlineData("TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS", "omit blockedReason")]
    [InlineData("TASK_START_NOT_ALLOWED", "set status=todo first")]
    [InlineData("TASK_START_NOT_ALLOWED", "reopen it first (complete=false)")]
    [InlineData("TASK_CREATION_PAST_DAY_NOT_ALLOWED", "or omit journalDate")]
    [InlineData("TASK_CREATION_PAST_DAY_NOT_ALLOWED", "journalDate must be today or later")]
    public async Task UnprocessableBlockCodes_GetOneLineOfGuidance(string code, string expectedGuidance)
    {
        var api = Fixtures.Client(new StubHandler());

        var act = () => ToolGuard.RunAsync(api, CancellationToken.None, () => throw new TaskFlowApiException(HttpStatusCode.UnprocessableEntity, code, $"Nope. [{code}]"));

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().StartWith($"Nope. [{code}]\n").And.Contain(expectedGuidance);
        message.Split('\n').Should().HaveCount(2);
    }

    [Fact]
    public async Task UnknownUnprocessableCode_GetsNoGuidance()
    {
        var api = Fixtures.Client(new StubHandler());

        var act = () => ToolGuard.RunAsync(api, CancellationToken.None, () => throw new TaskFlowApiException(HttpStatusCode.UnprocessableEntity, "OTHER", "Nope. [OTHER]"));

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Be("Nope. [OTHER]");
    }

    [Fact]
    public async Task ConnectionFailures_ExplainHowToStartTheApi()
    {
        var api = Fixtures.Client(new StubHandler());

        var act = () => ToolGuard.RunAsync(api, CancellationToken.None, () => throw new HttpRequestException("refused"));

        (await act.Should().ThrowAsync<McpException>()).Which.Message
            .Should().Contain("http://localhost:8081").And.Contain("docker compose up -d").And.Contain("TASKFLOW_API_URL");
    }

    [Fact]
    public async Task Timeouts_AreReported()
    {
        var api = Fixtures.Client(new StubHandler());

        var act = () => ToolGuard.RunAsync(api, CancellationToken.None, () => throw new TaskCanceledException());

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("did not respond in time");
    }

    [Fact]
    public async Task CallerCancellation_IsNotSwallowed()
    {
        var api = Fixtures.Client(new StubHandler());
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        var act = () => ToolGuard.RunAsync(api, cts.Token, () => throw new TaskCanceledException());

        await act.Should().ThrowAsync<TaskCanceledException>();
    }

    [Fact]
    public async Task McpExceptions_PassThroughUnchanged()
    {
        var api = Fixtures.Client(new StubHandler());
        var original = new McpException("bad input");

        var act = () => ToolGuard.RunAsync(api, CancellationToken.None, () => throw original);

        (await act.Should().ThrowAsync<McpException>()).Which.Should().BeSameAs(original);
    }
}

/// <summary>Guards the tool surface against drift: names, descriptions and parameter docs are what the model sees.</summary>
public class ToolSurfaceTests
{
    private static readonly string[] ExpectedTools =
    [
        "list_projects", "save_project", "project_status",
        "list_tasks", "get_task", "create_tasks", "update_task", "update_tasks", "delete_task", "add_task_note",
        "get_journal", "set_journal_todos", "add_log_entry", "update_journal",
        "weekly_review",
    ];

    private static IEnumerable<(MethodInfo Method, McpServerToolAttribute Attribute)> Tools() =>
        typeof(TaskTools).Assembly.GetTypes()
            .Where(t => t.GetCustomAttribute<McpServerToolTypeAttribute>() is not null)
            .SelectMany(t => t.GetMethods())
            .Select(m => (Method: m, Attribute: m.GetCustomAttribute<McpServerToolAttribute>()!))
            .Where(x => x.Attribute is not null);

    [Fact]
    public void ExposesExactlyTheExpectedTools() =>
        Tools().Select(t => t.Attribute.Name).Should().BeEquivalentTo(ExpectedTools);

    [Fact]
    public void EveryTool_HasADescription() =>
        Tools().Where(t => t.Method.GetCustomAttribute<DescriptionAttribute>() is not { Description.Length: > 40 })
            .Select(t => t.Attribute.Name).Should().BeEmpty("a tool description should explain when and how to use it");

    [Fact]
    public void EveryParameter_IsDocumented() =>
        Tools().SelectMany(t => t.Method.GetParameters()
                .Where(p => p.ParameterType != typeof(CancellationToken) && p.GetCustomAttribute<DescriptionAttribute>() is null)
                .Select(p => $"{t.Attribute.Name}.{p.Name}"))
            .Should().BeEmpty();

    [Fact]
    public void UpdateTask_DocumentsBlockedReason_AndBlockedStatus()
    {
        var update = Tools().Single(t => t.Attribute.Name == "update_task").Method;

        update.GetParameters().Should().Contain(p => p.Name == "blockedReason" && p.GetCustomAttribute<DescriptionAttribute>() != null);
        update.GetCustomAttribute<DescriptionAttribute>()!.Description.Should().Contain("Blocked");
        Tools().Single(t => t.Attribute.Name == "list_tasks").Method.GetCustomAttribute<DescriptionAttribute>()!.Description.Should().Contain("Blocked");
    }

    [Fact]
    public void UpdateTask_DocumentsJournalDate_AsAnOptionalParameterBeforeTheCancellationToken()
    {
        var update = Tools().Single(t => t.Attribute.Name == "update_task").Method;
        var parameters = update.GetParameters().Select(p => p.Name).ToList();

        var journalDate = update.GetParameters().SingleOrDefault(p => p.Name == "journalDate");
        journalDate.Should().NotBeNull("update_task must expose journalDate");
        journalDate!.GetCustomAttribute<DescriptionAttribute>()!.Description.Should().NotBeNullOrWhiteSpace().And.Contain("dueDate");
        journalDate.HasDefaultValue.Should().BeTrue();
        parameters.IndexOf("journalDate").Should().Be(parameters.IndexOf("blockedReason") + 1);
        parameters.IndexOf("journalDate").Should().Be(parameters.IndexOf("ct") - 1);

        var property = typeof(TaskUpdate).GetProperty("JournalDate");
        property.Should().NotBeNull("TaskUpdate must expose JournalDate");
        property!.GetCustomAttribute<DescriptionAttribute>()!.Description.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void UpdateTools_DescribeJournalDate_AndKeepItOptionalInTheSchema()
    {
        var updateTask = Tools().Single(t => t.Attribute.Name == "update_task").Method;
        var updateTasks = Tools().Single(t => t.Attribute.Name == "update_tasks").Method;

        updateTask.GetCustomAttribute<DescriptionAttribute>()!.Description.Should().Contain("journalDate").And.Contain("dueDate");
        updateTasks.GetCustomAttribute<DescriptionAttribute>()!.Description.Should().Contain("journalDate");

        var singleSchema = McpServerTool.Create(updateTask, new TaskTools(Fixtures.Client(new StubHandler()), Fixtures.Time())).ProtocolTool.InputSchema;
        singleSchema.GetProperty("properties").TryGetProperty("journalDate", out _).Should().BeTrue();
        RequiredNames(singleSchema).Should().NotContain("journalDate").And.Contain("id");

        var batchSchema = McpServerTool.Create(updateTasks, new TaskTools(Fixtures.Client(new StubHandler()), Fixtures.Time())).ProtocolTool.InputSchema;
        var item = batchSchema.GetProperty("properties").GetProperty("tasks").GetProperty("items");
        item.GetProperty("properties").TryGetProperty("journalDate", out _).Should().BeTrue();
        RequiredNames(item).Should().NotContain("journalDate");
    }

    private static List<string> RequiredNames(System.Text.Json.JsonElement schema) =>
        schema.TryGetProperty("required", out var required)
            ? required.EnumerateArray().Select(e => e.GetString()!).ToList()
            : [];

    [Fact]
    public void UpdateTasks_DocumentsEveryItemProperty_AndLimits()
    {
        var update = Tools().Single(t => t.Attribute.Name == "update_tasks");

        typeof(TaskUpdate).GetProperties().Where(p => p.GetCustomAttribute<DescriptionAttribute>() is null).Select(p => p.Name).Should().BeEmpty();
        update.Attribute.Idempotent.Should().BeTrue();
        update.Method.GetCustomAttribute<DescriptionAttribute>()!.Description.Should().Contain("25").And.Contain("update_task");
    }

    [Fact]
    public void UpdateJournal_DocumentsAppend_AndIsNotIdempotent()
    {
        var update = Tools().Single(t => t.Attribute.Name == "update_journal");

        update.Method.GetParameters().Should().Contain(p => p.Name == "append" && p.GetCustomAttribute<DescriptionAttribute>() != null);
        update.Method.GetCustomAttribute<DescriptionAttribute>()!.Description.Should().Contain("append=true").And.Contain("not idempotent");
        update.Attribute.Idempotent.Should().BeFalse();
    }

    [Fact]
    public void ListTasks_DescriptionsMentionNewFiltersAndAllNineViews()
    {
        var method = Tools().Single(t => t.Attribute.Name == "list_tasks").Method;
        var toolDescription = method.GetCustomAttribute<DescriptionAttribute>()!.Description;
        var viewDescription = method.GetParameters().Single(p => p.Name == "view").GetCustomAttribute<DescriptionAttribute>()!.Description;
        string[] views = ["open", "all", "completed", "overdue", "due_soon", "stale", "unassigned", "today", "blocked"];

        toolDescription.Should().Contain("completedFrom").And.Contain("completedTo").And.Contain("plannedDate");
        views.Should().OnlyContain(v => toolDescription.Contains(v) && viewDescription.Contains(v));
        foreach (var name in new[] { "completedFrom", "completedTo", "plannedDate" })
        {
            var description = method.GetParameters().Single(p => p.Name == name).GetCustomAttribute<DescriptionAttribute>()!.Description;
            description.Should().Contain("yyyy-MM-dd").And.Contain("yesterday");
        }
    }

    [Fact]
    public void ReadOnlyAndDestructiveFlags_AreSetWhereExpected()
    {
        var byName = Tools().ToDictionary(t => t.Attribute.Name!, t => t.Attribute);

        foreach (var name in new[] { "list_projects", "project_status", "list_tasks", "get_task", "weekly_review" })
        {
            byName[name].ReadOnly.Should().BeTrue(name);
        }

        byName["delete_task"].Destructive.Should().BeTrue();
    }
}
