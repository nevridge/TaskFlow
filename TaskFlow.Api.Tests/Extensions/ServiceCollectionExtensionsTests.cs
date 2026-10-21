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
        Assert.NotNull(serviceProvider.GetService<TaskDbContext>());
        Assert.NotNull(serviceProvider.GetService<ITaskRepository>());
        Assert.IsType<TaskRepository>(serviceProvider.GetService<ITaskRepository>());
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
        Assert.NotNull(serviceProvider.GetService<IValidator<TaskItem>>());
        Assert.IsType<TaskItemValidator>(serviceProvider.GetService<IValidator<TaskItem>>());
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
        Assert.NotNull(healthCheckService);
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
        Assert.Contains(services, s => s.ServiceType.Name.Contains("OpenApi"));
    }

    [Fact]
    public void ConfigureJsonSerialization_ShouldRegisterJsonOptions()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        services.ConfigureJsonSerialization();

        // Assert
        Assert.Contains(services, s =>
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
        Assert.Contains(services, s => s.ServiceType == typeof(TracerProvider));
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
        Assert.Same(services, result);
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
        Assert.NotNull(serviceProvider.GetService<TaskDbContext>());
        Assert.NotNull(serviceProvider.GetService<ITaskRepository>());
        Assert.NotNull(serviceProvider.GetService<IValidator<TaskItem>>());
        Assert.NotNull(serviceProvider.GetService<HealthCheckService>());
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
        Assert.Contains(services, s => s.ServiceType == typeof(TaskDbContext));
        Assert.Contains(services, s => s.ServiceType == typeof(ITaskRepository));
        Assert.Contains(services, s => s.ServiceType == typeof(IValidator<TaskItem>));
        Assert.Contains(services, s => s.ServiceType == typeof(HealthCheckService));
        Assert.Contains(services, s => s.ServiceType == typeof(TracerProvider));
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
        Assert.True(httpJsonOptions.SerializerOptions.WriteIndented);
        Assert.Equal(System.Text.Json.JsonNamingPolicy.CamelCase, httpJsonOptions.SerializerOptions.PropertyNamingPolicy);
    }
}
