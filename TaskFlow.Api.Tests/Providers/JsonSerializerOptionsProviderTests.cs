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
            ["autoCompleteParentWhenChildrenDone", "description", "dueDate", "parentTaskItemId", "priority", "status", "timezoneOffsetMinutes", "title"],
            names);
    }
}
