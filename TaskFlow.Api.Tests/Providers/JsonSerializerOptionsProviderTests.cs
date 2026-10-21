using System.Text.Json;
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
}
