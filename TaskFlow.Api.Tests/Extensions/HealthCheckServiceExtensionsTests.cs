using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Moq;
using TaskFlow.Api.Extensions;
using TaskFlow.Api.HealthChecks;

namespace TaskFlow.Api.Tests.Extensions;

public class HealthCheckServiceExtensionsTests
{
    [Fact]
    public void CreateHealthCheckOptions_ShouldSetResponseWriter()
    {
        var options = HealthCheckServiceExtensions.CreateHealthCheckOptions();

        Assert.Equal((Func<HttpContext, HealthReport, Task>)HealthCheckResponseWriter.WriteHealthCheckResponse, options.ResponseWriter);
    }

    [Fact]
    public void CreateHealthCheckOptions_ShouldConfigureStatusCodes()
    {
        var options = HealthCheckServiceExtensions.CreateHealthCheckOptions();

        Assert.Equal(StatusCodes.Status200OK, options.ResultStatusCodes[HealthStatus.Healthy]);
        Assert.Equal(StatusCodes.Status200OK, options.ResultStatusCodes[HealthStatus.Degraded]);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, options.ResultStatusCodes[HealthStatus.Unhealthy]);
    }

    [Fact]
    public void CreateReadinessHealthCheckOptions_ShouldIncludeOnlyReadyTaggedChecks()
    {
        var options = HealthCheckServiceExtensions.CreateReadinessHealthCheckOptions();

        Assert.NotNull(options.Predicate);

        var healthCheck = Mock.Of<IHealthCheck>();
        var readyRegistration = new HealthCheckRegistration("database", healthCheck, null, new[] { "ready" });
        var liveRegistration = new HealthCheckRegistration("self", healthCheck, null, new[] { "live" });

        Assert.True(options.Predicate!(readyRegistration));
        Assert.False(options.Predicate!(liveRegistration));
    }

    [Fact]
    public void CreateLivenessHealthCheckOptions_ShouldIncludeOnlyLiveTaggedChecks()
    {
        var options = HealthCheckServiceExtensions.CreateLivenessHealthCheckOptions();

        Assert.NotNull(options.Predicate);

        var healthCheck = Mock.Of<IHealthCheck>();
        var liveRegistration = new HealthCheckRegistration("self", healthCheck, null, new[] { "live" });
        var readyRegistration = new HealthCheckRegistration("database", healthCheck, null, new[] { "ready" });

        Assert.True(options.Predicate!(liveRegistration));
        Assert.False(options.Predicate!(readyRegistration));
    }
}
