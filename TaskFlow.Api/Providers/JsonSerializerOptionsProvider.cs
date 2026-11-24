using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace TaskFlow.Api.Providers;

public static class JsonSerializerOptionsProvider
{
    private static readonly JsonSerializerOptions _defaultOptions = CreateDefaultOptions();

    public static JsonSerializerOptions Default => _defaultOptions;

    /// <summary>
    /// Configures JsonSerializerOptions with application-wide settings
    /// </summary>
    public static void ConfigureOptions(JsonSerializerOptions options)
    {
        options.WriteIndented = true;
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.ReferenceHandler = ReferenceHandler.IgnoreCycles; // Handle circular references
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)); // Accept and return enums as strings
    }

    private static JsonSerializerOptions CreateDefaultOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ConfigureOptions(options);

        // This was required for .NET 9: Set TypeInfoResolver before MakeReadOnly()
        // TODO: Is this still required in .NET 11?
        options.TypeInfoResolver = new DefaultJsonTypeInfoResolver();

        options.MakeReadOnly();
        return options;
    }
}
