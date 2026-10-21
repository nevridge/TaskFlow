using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Moq;
using OpenTelemetry.Trace;
using TaskFlow.Api.Extensions;

namespace TaskFlow.Api.Tests.Extensions;

public class OpenTelemetryServiceExtensionsTests
{
    private static IConfiguration BuildConfiguration(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    // ── AddOpenTelemetryObservability ───────────────────────────────────────

    [Fact]
    public void AddOpenTelemetryObservability_WithDefaultSettings_RegistersOpenTelemetry()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:ServiceName", "TestApp" },
            { "OpenTelemetry:Endpoint", "http://localhost:4317" }
        });

        services.AddOpenTelemetryObservability(config);

        Assert.Contains(services, s => s.ServiceType == typeof(TracerProvider));
    }

    [Fact]
    public void AddOpenTelemetryObservability_ReturnsServiceCollection()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>());

        var result = services.AddOpenTelemetryObservability(config);

        Assert.Same(services, result);
    }

    [Fact]
    public void AddOpenTelemetryObservability_WithHttpProtobufProtocol_DoesNotThrow()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Protocol", "http/protobuf" }
        });

        var act = () => services.AddOpenTelemetryObservability(config);

        Assert.Null(Record.Exception(act));
    }

    [Fact]
    public void AddOpenTelemetryObservability_WithGrpcProtocol_ThrowsInvalidOperationException()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Protocol", "grpc" }
        });

        var act = () => services.AddOpenTelemetryObservability(config);

        var ex = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("grpc", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AddOpenTelemetryObservability_WithInvalidProtocol_ThrowsInvalidOperationException()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Protocol", "unsupported-protocol" }
        });

        var act = () => services.AddOpenTelemetryObservability(config);

        var ex = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("unsupported-protocol", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AddOpenTelemetryObservability_WithHeader_DoesNotThrow()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Header", "X-Seq-ApiKey=test-api-key" }
        });

        var act = () => services.AddOpenTelemetryObservability(config);

        Assert.Null(Record.Exception(act));
    }

    [Fact]
    public void AddOpenTelemetryObservability_WithNullProtocol_DefaultsToHttpProtobuf()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Protocol", null }
        });

        var act = () => services.AddOpenTelemetryObservability(config);

        Assert.Null(Record.Exception(act));
    }

    [Fact]
    public void AddOpenTelemetryObservability_WithEmptyProtocol_DefaultsToHttpProtobuf()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Protocol", "" }
        });

        var act = () => services.AddOpenTelemetryObservability(config);

        Assert.Null(Record.Exception(act));
    }

    // ── AddApplicationLogging ───────────────────────────────────────────────

    [Fact]
    public void AddApplicationLogging_NonDevelopmentEnvironment_ReturnsLoggingBuilder()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:ServiceName", "TestApp" },
            { "OpenTelemetry:Endpoint", "http://localhost:4317" }
        });

        var envMock = new Mock<IHostEnvironment>();
        envMock.Setup(e => e.EnvironmentName).Returns(Environments.Production);
        var env = envMock.Object;

        ILoggingBuilder? capturedBuilder = null;
        services.AddLogging(builder =>
        {
            capturedBuilder = builder.AddApplicationLogging(config, env);
        });

        Assert.NotNull(capturedBuilder);
    }

    [Fact]
    public void AddApplicationLogging_DevelopmentEnvironment_ReturnsLoggingBuilder()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:ServiceName", "TestApp" },
            { "OpenTelemetry:Endpoint", "http://localhost:4317" }
        });

        var envMock = new Mock<IHostEnvironment>();
        envMock.Setup(e => e.EnvironmentName).Returns(Environments.Development);
        var env = envMock.Object;

        ILoggingBuilder? capturedBuilder = null;
        services.AddLogging(builder =>
        {
            capturedBuilder = builder.AddApplicationLogging(config, env);
        });

        Assert.NotNull(capturedBuilder);
    }

    [Fact]
    public void AddApplicationLogging_WithGrpcProtocol_ThrowsInvalidOperationException()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Protocol", "grpc" }
        });

        var envMock = new Mock<IHostEnvironment>();
        envMock.Setup(e => e.EnvironmentName).Returns(Environments.Production);
        var env = envMock.Object;

        var act = () => services.AddLogging(builder => builder.AddApplicationLogging(config, env));

        var ex = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("grpc", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AddApplicationLogging_WithInvalidProtocol_ThrowsInvalidOperationException()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Protocol", "invalid" }
        });

        var envMock = new Mock<IHostEnvironment>();
        envMock.Setup(e => e.EnvironmentName).Returns(Environments.Production);
        var env = envMock.Object;

        var act = () => services.AddLogging(builder => builder.AddApplicationLogging(config, env));

        var ex = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("invalid", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AddApplicationLogging_WithHeader_DoesNotThrow()
    {
        var services = new ServiceCollection();
        var config = BuildConfiguration(new Dictionary<string, string?>
        {
            { "OpenTelemetry:Header", "X-Seq-ApiKey=test-key" }
        });

        var envMock = new Mock<IHostEnvironment>();
        envMock.Setup(e => e.EnvironmentName).Returns(Environments.Production);
        var env = envMock.Object;

        var act = () => services.AddLogging(builder => builder.AddApplicationLogging(config, env));

        Assert.Null(Record.Exception(act));
    }
}
