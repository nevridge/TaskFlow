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

        Assert.Contains(services, s => s.ServiceType == typeof(ICorsService));
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

        Assert.Same(services, result);
    }

    [Fact]
    public void AddCorsPolicy_WithNoOrigins_ShouldBeNoOp()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        services.AddCorsPolicy(configuration);

        Assert.DoesNotContain(services, s => s.ServiceType == typeof(ICorsService));
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

        Assert.Equal(new[] { "http://localhost:5173", "http://localhost:3000" }.Order(), origins.Order());
    }

    [Fact]
    public void GetConfiguredOrigins_WithNoOrigins_ShouldReturnEmpty()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        var origins = CorsServiceExtensions.GetConfiguredOrigins(configuration);

        Assert.Empty(origins);
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

        Assert.Equal("https://taskflow.skalaforge.com", Assert.Single(origins));
    }
}
