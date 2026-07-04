using FluentAssertions;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TaskFlow.Api.Extensions;

namespace TaskFlow.Api.Tests.Extensions;

public class CorsServiceExtensionsTests
{
    [Fact]
    public void AddCorsPolicy_ShouldRegisterCorsServices()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "Cors:AllowedOrigins:0", "http://localhost:5173" }
            })
            .Build();

        services.AddCorsPolicy(configuration);

        services.Should().Contain(s => s.ServiceType == typeof(ICorsService));
    }

    [Fact]
    public void AddCorsPolicy_ShouldReturnServiceCollection()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "Cors:AllowedOrigins:0", "http://localhost:5173" }
            })
            .Build();

        var result = services.AddCorsPolicy(configuration);

        result.Should().BeSameAs(services);
    }

    [Fact]
    public void AddCorsPolicy_WithNoOrigins_ShouldBeNoOp()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        services.AddCorsPolicy(configuration);

        services.Should().NotContain(s => s.ServiceType == typeof(ICorsService));
    }

    [Fact]
    public void GetConfiguredOrigins_WithOrigins_ShouldReturnOrigins()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "Cors:AllowedOrigins:0", "http://localhost:5173" },
                { "Cors:AllowedOrigins:1", "http://localhost:3000" }
            })
            .Build();

        var origins = CorsServiceExtensions.GetConfiguredOrigins(configuration);

        origins.Should().BeEquivalentTo(["http://localhost:5173", "http://localhost:3000"]);
    }

    [Fact]
    public void GetConfiguredOrigins_WithNoOrigins_ShouldReturnEmpty()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        var origins = CorsServiceExtensions.GetConfiguredOrigins(configuration);

        origins.Should().BeEmpty();
    }

    [Fact]
    public void GetConfiguredOrigins_WhenLoadedFromProductionAppsettings_ShouldReturnProductionOrigin()
    {
        var apiProjectPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "TaskFlow.Api");
        var configuration = new ConfigurationBuilder()
            .SetBasePath(apiProjectPath)
            .AddJsonFile("appsettings.json")
            .AddJsonFile("appsettings.Production.json")
            .Build();

        var origins = CorsServiceExtensions.GetConfiguredOrigins(configuration);

        origins.Should().BeEquivalentTo(["https://taskflow.skalaforge.com"]);
    }
}
