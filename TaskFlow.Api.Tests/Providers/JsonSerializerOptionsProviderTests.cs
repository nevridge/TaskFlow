using System.Text.Json;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Providers;

namespace TaskFlow.Api.Tests.Providers;

public class JsonSerializerOptionsProviderTests
{
    [Fact]
    public void Default_ShouldReturnConfiguredOptions()
    {
        var options = JsonSerializerOptionsProvider.Default;

        Assert.NotNull(options);
        Assert.True(options.WriteIndented);
        Assert.Equal(JsonNamingPolicy.CamelCase, options.PropertyNamingPolicy);
    }

    [Fact]
    public void Default_ShouldBeSameInstance_WhenAccessedMultipleTimes()
    {
        var first = JsonSerializerOptionsProvider.Default;
        var second = JsonSerializerOptionsProvider.Default;

        Assert.Same(second, first);
    }

    [Fact]
    public void Default_ShouldBeReadOnly()
    {
        var options = JsonSerializerOptionsProvider.Default;

        Assert.True(options.IsReadOnly);
    }

    [Fact]
    public void ConfigureOptions_ShouldSetWriteIndented()
    {
        var options = new JsonSerializerOptions();

        JsonSerializerOptionsProvider.ConfigureOptions(options);

        Assert.True(options.WriteIndented);
    }

    [Fact]
    public void ConfigureOptions_ShouldSetCamelCaseNamingPolicy()
    {
        var options = new JsonSerializerOptions();

        JsonSerializerOptionsProvider.ConfigureOptions(options);

        Assert.Equal(JsonNamingPolicy.CamelCase, options.PropertyNamingPolicy);
    }

    private static JsonSerializerOptions CreateRequestOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        JsonSerializerOptionsProvider.ConfigureOptions(options);
        return options;
    }

    [Theory]
    [InlineData("""{"title":"x","status":"completed","isComplete":true}""", Status.Completed)]
    [InlineData("""{"isComplete":true,"status":"todo"}""", Status.Todo)]
    [InlineData("""{"isComplete":false,"status":"completed"}""", Status.Completed)]
    public void Deserialize_ShouldIgnoreUnknownIsCompleteAndParseLowercaseStatus_ForAllWriteDtos(string json, Status expected)
    {
        var options = CreateRequestOptions();

        var update = JsonSerializer.Deserialize<UpdateTaskItemDto>(json, options);
        var create = JsonSerializer.Deserialize<CreateTaskItemDto>(json, options);
        var patch = JsonSerializer.Deserialize<PatchTaskItemDto>(json, options);

        Assert.Equal(expected, update!.Status);
        Assert.Equal(expected, create!.Status);
        Assert.Equal(expected, patch!.Status);
    }

    [Theory]
    [InlineData("""{"status":"inProgress"}""")]
    [InlineData("""{"status":"inprogress"}""")]
    [InlineData("""{"status":"InProgress"}""")]
    public void Deserialize_ShouldParseInProgressStatus_InAnyCasing(string json)
    {
        var options = CreateRequestOptions();

        Assert.Equal(Status.InProgress, JsonSerializer.Deserialize<UpdateTaskItemDto>(json, options)!.Status);
        Assert.Equal(Status.InProgress, JsonSerializer.Deserialize<CreateTaskItemDto>(json, options)!.Status);
        Assert.Equal(Status.InProgress, JsonSerializer.Deserialize<PatchTaskItemDto>(json, options)!.Status);
    }

    [Fact]
    public void PatchDto_ShouldReportNothingPresent_ForEmptyObject()
    {
        var patch = JsonSerializer.Deserialize<PatchTaskItemDto>("{}", CreateRequestOptions())!;

        Assert.False(patch.IsPresent("Title"));
        Assert.False(patch.IsPresent("Description"));
        Assert.False(patch.IsPresent("Status"));
        Assert.False(patch.IsPresent("Priority"));
        Assert.False(patch.IsPresent("DueDate"));
        Assert.False(patch.IsPresent("ParentTaskItemId"));
    }

    [Theory]
    [InlineData("""{"description":null}""", "Description")]
    [InlineData("""{"dueDate":null}""", "DueDate")]
    [InlineData("""{"parentTaskItemId":null}""", "ParentTaskItemId")]
    [InlineData("""{"title":null}""", "Title")]
    [InlineData("""{"description":"d"}""", "Description")]
    public void PatchDto_ShouldReportExplicitFieldsAsPresent_IncludingNull(string json, string property)
    {
        var patch = JsonSerializer.Deserialize<PatchTaskItemDto>(json, CreateRequestOptions())!;

        Assert.True(patch.IsPresent(property));
        Assert.True(patch.IsPresent(property.ToLowerInvariant()));
        Assert.True(patch.IsPresent(property.ToUpperInvariant()));
    }

    [Fact]
    public void PatchDto_ShouldBindJournalDateAndTrackPresence()
    {
        var withDate = JsonSerializer.Deserialize<PatchTaskItemDto>("""{"journalDate":"2030-01-02"}""", CreateRequestOptions())!;
        var withNull = JsonSerializer.Deserialize<PatchTaskItemDto>("""{"journalDate":null}""", CreateRequestOptions())!;
        var absent = JsonSerializer.Deserialize<PatchTaskItemDto>("""{"title":"t"}""", CreateRequestOptions())!;

        Assert.Equal(new DateOnly(2030, 1, 2), withDate.JournalDate);
        Assert.True(withNull.IsPresent("JournalDate"));
        Assert.Null(withNull.JournalDate);
        Assert.False(absent.IsPresent("JournalDate"));
    }

    [Fact]
    public void PatchDto_ShouldOnlyReportSuppliedFieldsAsPresent()
    {
        var patch = JsonSerializer.Deserialize<PatchTaskItemDto>("""{"title":"t"}""", CreateRequestOptions())!;

        Assert.True(patch.IsPresent("Title"));
        Assert.False(patch.IsPresent("Description"));
        Assert.False(patch.IsPresent("DueDate"));
    }

    [Fact]
    public void PatchDto_ShouldNotSerializePresenceTracking()
    {
        var json = JsonSerializer.Serialize(new PatchTaskItemDto { Title = "t" }, CreateRequestOptions());

        using var document = JsonDocument.Parse(json);
        var names = document.RootElement.EnumerateObject().Select(p => p.Name).Order().ToList();
        Assert.Equal(
            ["autoCompleteParentWhenChildrenDone", "blockedReason", "description", "dueDate", "journalDate", "parentTaskItemId", "priority", "status", "timezoneOffsetMinutes", "title"],
            names);
    }

    [Fact]
    public void Serialize_ResponseDtoWithDueDate_WritesCalendarDateString()
    {
        var json = JsonSerializer.Serialize(new TaskItemResponseDto { Title = "t", DueDate = new DateOnly(2026, 5, 1) }, JsonSerializerOptionsProvider.Default);

        using var document = JsonDocument.Parse(json);
        var due = document.RootElement.GetProperty("dueDate");
        Assert.Equal(JsonValueKind.String, due.ValueKind);
        Assert.Equal("2026-05-01", due.GetString());
        Assert.Contains("\"2026-05-01\"", json);
    }

    [Fact]
    public void Serialize_ResponseDtoWithoutDueDate_WritesNull()
    {
        var json = JsonSerializer.Serialize(new TaskItemResponseDto { Title = "t" }, JsonSerializerOptionsProvider.Default);

        using var document = JsonDocument.Parse(json);
        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("dueDate").ValueKind);
    }

    [Fact]
    public void Deserialize_CreateDtoWithDateOnlyString_ParsesDate()
    {
        var dto = JsonSerializer.Deserialize<CreateTaskItemDto>("""{"title":"t","dueDate":"2026-05-01"}""", JsonSerializerOptionsProvider.Default);

        Assert.Equal(new DateOnly(2026, 5, 1), dto!.DueDate);
    }

    [Fact]
    public void Deserialize_CreateDtoWithNullDueDate_ParsesNull()
    {
        var dto = JsonSerializer.Deserialize<CreateTaskItemDto>("""{"title":"t","dueDate":null}""", JsonSerializerOptionsProvider.Default);

        Assert.Null(dto!.DueDate);
    }

    [Theory]
    [InlineData("2026-05-01T00:00:00.000Z")]
    [InlineData("2026-05-01T00:00:00")]
    [InlineData("2026-05-01 00:00:00")]
    [InlineData("2026-13-40")]
    [InlineData("05/01/2026")]
    [InlineData("")]
    public void Deserialize_CreateDtoWithNonCalendarDueDate_ThrowsJsonException(string value)
    {
        var json = $$"""{"title":"t","dueDate":"{{value}}"}""";

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CreateTaskItemDto>(json, JsonSerializerOptionsProvider.Default));
    }

    [Fact]
    public void Deserialize_PatchDtoWithIsoTimestampDueDate_ThrowsJsonException()
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<PatchTaskItemDto>("""{"dueDate":"2026-05-01T00:00:00.000Z"}""", JsonSerializerOptionsProvider.Default));
    }
}
