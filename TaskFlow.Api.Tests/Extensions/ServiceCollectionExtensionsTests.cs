using FluentAssertions;
using FluentValidation;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using OpenTelemetry.Trace;
using TaskFlow.Api.Data;
using TaskFlow.Api.Extensions;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Extensions;

public class ServiceCollectionExtensionsTests
{
    [Fact]
    public void AddPersistence_ShouldRegisterDbContextAndRepositories()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ConnectionStrings:DefaultConnection", "Data Source=:memory:" }
            })
            .Build();

        // Act
        services.AddPersistence(configuration);
        var serviceProvider = services.BuildServiceProvider();

        // Assert
        serviceProvider.GetService<TaskDbContext>().Should().NotBeNull();
        serviceProvider.GetService<ITaskRepository>().Should().NotBeNull();
        serviceProvider.GetService<ITaskRepository>().Should().BeOfType<TaskRepository>();
    }

    [Fact]
    public void AddValidation_ShouldRegisterValidators()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
            { "ConnectionStrings:DefaultConnection", "Data Source=:memory:" }
            })
            .Build();

        // Act
        services.AddPersistence(configuration);
        services.AddValidation();
        var serviceProvider = services.BuildServiceProvider();

        // Assert
        serviceProvider.GetService<IValidator<TaskItem>>().Should().NotBeNull();
        serviceProvider.GetService<IValidator<TaskItem>>().Should().BeOfType<TaskItemValidator>();
    }

    [Fact]
    public void AddApplicationHealthChecks_ShouldRegisterHealthChecks()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ConnectionStrings:DefaultConnection", "Data Source=:memory:" }
            })
            .Build();

        // Act
        services.AddLogging(); // HealthCheckService requires logging
        services.AddPersistence(configuration);
        services.AddApplicationHealthChecks();
        var serviceProvider = services.BuildServiceProvider();

        // Assert
        var healthCheckService = serviceProvider.GetService<HealthCheckService>();
        healthCheckService.Should().NotBeNull();
    }

    [Fact]
    public void AddOpenApi_ShouldRegisterOpenApiServices()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        OpenApiServiceExtensions.AddOpenApi(services);

        // Assert
        // Microsoft.AspNetCore.OpenApi registers services with "OpenApi" in the name
        services.Should().Contain(s => s.ServiceType.Name.Contains("OpenApi"));
    }

    [Fact]
    public void ConfigureJsonSerialization_ShouldRegisterJsonOptions()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        services.ConfigureJsonSerialization();

        // Assert
        services.Should().Contain(s =>
            s.ServiceType.Name.Contains("JsonOptions") ||
            s.ServiceType.Name.Contains("ConfigureOptions"));
    }

    [Fact]
    public void AddOpenTelemetryObservability_ShouldRegisterOpenTelemetryServices()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "OpenTelemetry:ServiceName", "TestApp" },
                { "OpenTelemetry:Endpoint", "http://localhost:5341/ingest/otlp" }
            })
            .Build();

        // Act
        services.AddOpenTelemetryObservability(configuration);

        // Assert
        services.Should().Contain(s => s.ServiceType == typeof(TracerProvider));
    }

    [Fact]
    public void AddOpenTelemetryObservability_ShouldReturnServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "OpenTelemetry:ServiceName", "TestApp" },
                { "OpenTelemetry:Endpoint", "http://localhost:5341/ingest/otlp" }
            })
            .Build();

        // Act
        var result = services.AddOpenTelemetryObservability(configuration);

        // Assert
        result.Should().BeSameAs(services);
    }

    [Fact]
    public void AllExtensions_ShouldWorkTogether()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ConnectionStrings:DefaultConnection", "Data Source=:memory:" }
            })
            .Build();

        // Act
        services.AddLogging(); // Required for health checks
        services.AddPersistence(configuration);
        services.AddValidation();
        services.AddApplicationHealthChecks();
        OpenApiServiceExtensions.AddOpenApi(services);
        services.ConfigureJsonSerialization();

        var serviceProvider = services.BuildServiceProvider();

        // Assert - verify all critical services are registered
        serviceProvider.GetService<TaskDbContext>().Should().NotBeNull();
        serviceProvider.GetService<ITaskRepository>().Should().NotBeNull();
        serviceProvider.GetService<IValidator<TaskItem>>().Should().NotBeNull();
        serviceProvider.GetService<HealthCheckService>().Should().NotBeNull();
    }

    [Fact]
    public void AllExtensionsWithOpenTelemetry_ShouldRegisterAllServices()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ConnectionStrings:DefaultConnection", "Data Source=:memory:" },
                { "OpenTelemetry:ServiceName", "TestApp" },
                { "OpenTelemetry:Endpoint", "http://localhost:5341/ingest/otlp" }
            })
            .Build();

        // Act
        services.AddLogging();
        services.AddPersistence(configuration);
        services.AddValidation();
        services.AddApplicationHealthChecks();
        services.AddOpenTelemetryObservability(configuration);
        OpenApiServiceExtensions.AddOpenApi(services);
        services.ConfigureJsonSerialization();

        // Assert - verify all services are registered in the collection
        services.Should().Contain(s => s.ServiceType == typeof(TaskDbContext));
        services.Should().Contain(s => s.ServiceType == typeof(ITaskRepository));
        services.Should().Contain(s => s.ServiceType == typeof(IValidator<TaskItem>));
        services.Should().Contain(s => s.ServiceType == typeof(HealthCheckService));
        services.Should().Contain(s => s.ServiceType == typeof(TracerProvider));
    }

    [Fact]
    public void ConfigureJsonSerialization_OptionLambdas_ExecuteWhenOptionsResolved()
    {
        // Arrange
        var services = new ServiceCollection();
        services.ConfigureJsonSerialization();
        var serviceProvider = services.BuildServiceProvider();

        // Act - resolve HttpJson options, which triggers the ConfigureHttpJsonOptions lambda
        var httpJsonOptions = serviceProvider
            .GetRequiredService<IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions>>().Value;

        // Assert
        httpJsonOptions.SerializerOptions.WriteIndented.Should().BeTrue();
        httpJsonOptions.SerializerOptions.PropertyNamingPolicy.Should().Be(System.Text.Json.JsonNamingPolicy.CamelCase);
    }
}
