using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using TaskFlow.Api.HealthChecks;
using TaskFlow.Api.Providers;

namespace TaskFlow.Api.Tests.HealthChecks;

public class HealthCheckResponseWriterTests
{
    private static DefaultHttpContext CreateHttpContextWithServices()
    {
        var services = new ServiceCollection();

        // Configure JsonOptions using the shared configuration
        services.Configure<JsonOptions>(options =>
        {
            JsonSerializerOptionsProvider.ConfigureOptions(options.SerializerOptions);
        });

        var serviceProvider = services.BuildServiceProvider();

        var context = new DefaultHttpContext
        {
            RequestServices = serviceProvider
        };

        return context;
    }

    [Fact]
    public async Task WriteHealthCheckResponse_ShouldWriteHealthyStatus()
    {
        // Arrange
        var context = CreateHttpContextWithServices();
        var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        var healthReport = new HealthReport(
            new Dictionary<string, HealthReportEntry>
            {
                ["database"] = new HealthReportEntry(
                    HealthStatus.Healthy,
                    "Database is healthy",
                    TimeSpan.FromMilliseconds(50),
                    null,
                    null)
            },
            TimeSpan.FromMilliseconds(100));

        // Act
        await HealthCheckResponseWriter.WriteHealthCheckResponse(context, healthReport);

        // Assert
        responseBody.Position = 0;
        using var reader = new StreamReader(responseBody);
        var response = await reader.ReadToEndAsync();

        Assert.False(string.IsNullOrEmpty(response));
        Assert.Contains("Healthy", response);
        Assert.Contains("database", response);
        Assert.Equal("application/json; charset=utf-8", context.Response.ContentType);
    }

    [Fact]
    public async Task WriteHealthCheckResponse_ShouldWriteUnhealthyStatus()
    {
        // Arrange
        var context = CreateHttpContextWithServices();
        var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        var healthReport = new HealthReport(
            new Dictionary<string, HealthReportEntry>
            {
                ["database"] = new HealthReportEntry(
                    HealthStatus.Unhealthy,
                    "Database connection failed",
                    TimeSpan.FromMilliseconds(50),
                    new InvalidOperationException("Connection error"),
                    null)
            },
            TimeSpan.FromMilliseconds(100));

        // Act
        await HealthCheckResponseWriter.WriteHealthCheckResponse(context, healthReport);

        // Assert
        responseBody.Position = 0;
        using var reader = new StreamReader(responseBody);
        var response = await reader.ReadToEndAsync();

        Assert.False(string.IsNullOrEmpty(response));
        Assert.Contains("Unhealthy", response);
        Assert.Contains("database", response);
        Assert.Contains("Connection error", response);
    }

    [Fact]
    public async Task WriteHealthCheckResponse_ShouldIncludeMultipleEntries()
    {
        // Arrange
        var context = CreateHttpContextWithServices();
        var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        var healthReport = new HealthReport(
            new Dictionary<string, HealthReportEntry>
            {
                ["database"] = new HealthReportEntry(
                    HealthStatus.Healthy,
                    "Database is healthy",
                    TimeSpan.FromMilliseconds(30),
                    null,
                    null),
                ["api"] = new HealthReportEntry(
                    HealthStatus.Healthy,
                    "API is running",
                    TimeSpan.FromMilliseconds(10),
                    null,
                    null)
            },
            TimeSpan.FromMilliseconds(50));

        // Act
        await HealthCheckResponseWriter.WriteHealthCheckResponse(context, healthReport);

        // Assert
        responseBody.Position = 0;
        using var reader = new StreamReader(responseBody);
        var response = await reader.ReadToEndAsync();

        Assert.Contains("database", response);
        Assert.Contains("api", response);
    }

    [Fact]
    public async Task WriteHealthCheckResponse_ShouldHandleDegradedStatus()
    {
        // Arrange
        var context = CreateHttpContextWithServices();
        var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        var healthReport = new HealthReport(
            new Dictionary<string, HealthReportEntry>
            {
                ["service"] = new HealthReportEntry(
                    HealthStatus.Degraded,
                    "Service is degraded",
                    TimeSpan.FromMilliseconds(100),
                    null,
                    null)
            },
            TimeSpan.FromMilliseconds(150));

        // Act
        await HealthCheckResponseWriter.WriteHealthCheckResponse(context, healthReport);

        // Assert
        responseBody.Position = 0;
        using var reader = new StreamReader(responseBody);
        var response = await reader.ReadToEndAsync();

        Assert.Contains("Degraded", response);
    }

    [Fact]
    public async Task WriteHealthCheckResponse_ShouldIncludeCustomData()
    {
        // Arrange
        var context = CreateHttpContextWithServices();
        var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        var customData = new Dictionary<string, object>
        {
            ["ConnectionString"] = "Server=localhost",
            ["Version"] = "1.0.0"
        };

        var healthReport = new HealthReport(
            new Dictionary<string, HealthReportEntry>
            {
                ["database"] = new HealthReportEntry(
                    HealthStatus.Healthy,
                    "Database is healthy",
                    TimeSpan.FromMilliseconds(50),
                    null,
                    customData)
            },
            TimeSpan.FromMilliseconds(100));

        // Act
        await HealthCheckResponseWriter.WriteHealthCheckResponse(context, healthReport);

        // Assert
        responseBody.Position = 0;
        using var reader = new StreamReader(responseBody);
        var response = await reader.ReadToEndAsync();

        Assert.Contains("ConnectionString", response);
        Assert.Contains("Version", response);
    }

    [Fact]
    public async Task WriteHealthCheckResponse_WhenExceptionMessageContainsSpecialChars_ResponseIsValidJson()
    {
        // Arrange
        var context = CreateHttpContextWithServices();
        var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        // Exception message containing JSON-special characters: quotes, backslash, newline
        var trickyMessage = "message with \"quotes\" and \\ backslash and\nnewline";
        var healthReport = new HealthReport(
            new Dictionary<string, HealthReportEntry>
            {
                ["service"] = new HealthReportEntry(
                    HealthStatus.Unhealthy,
                    "failed",
                    TimeSpan.FromMilliseconds(5),
                    new InvalidOperationException(trickyMessage),
                    null)
            },
            TimeSpan.FromMilliseconds(5));

        // Act
        await HealthCheckResponseWriter.WriteHealthCheckResponse(context, healthReport);

        // Assert – the output must always be valid JSON
        responseBody.Position = 0;
        using var reader = new StreamReader(responseBody);
        var json = await reader.ReadToEndAsync();

        var act = () => System.Text.Json.JsonDocument.Parse(json);
        // the response must be valid JSON even when exception messages contain special characters
        Assert.Null(Record.Exception(act));
        Assert.Contains("Unhealthy", json);
    }
}
