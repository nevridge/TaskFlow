using Microsoft.Extensions.DependencyInjection;
using TaskFlow.Api.Extensions;

namespace TaskFlow.Api.Tests.Extensions;

public class ApiVersioningServiceExtensionsTests
{
    [Fact]
    public void AddApiVersioningConfiguration_ShouldRegisterApiVersioningServices()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var result = services.AddApiVersioningConfiguration();

        // Assert
        Assert.Same(services, result);

        // Verify that API versioning services are registered by checking the service collection
        Assert.Contains(services, s => s.ServiceType.FullName != null &&
                                       s.ServiceType.FullName.Contains("ApiVersion"));
    }

    [Fact]
    public void AddApiVersioningConfiguration_ShouldReturnServiceCollection()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var result = services.AddApiVersioningConfiguration();

        // Assert
        Assert.NotNull(result);
        Assert.IsType<ServiceCollection>(result);
    }
}
