using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TaskFlow.Mcp.Integration.Tests.Infrastructure;

namespace TaskFlow.Mcp.Integration.Tests;

public sealed class HarnessTests : IntegrationTestBase
{
    [Fact]
    public async Task Client_TargetsTestServer_WithVersionedRoutesAndHeader()
    {
        // Catches AddTaskFlowApi silently falling back to localhost:8081 (NormalizeBaseUrl) and HTTPS redirects.
        Assert.Equal("http://localhost", Client.BaseUrl);

        await Client.GetTasksAsync(Ct);

        var call = Assert.Single(Harness.Recorder.Calls);
        Assert.StartsWith("/api/v1/", call.Path);
        Assert.Equal("1.0", call.ApiVersion);
        Assert.Equal(System.Net.HttpStatusCode.OK, call.Status);
    }

    [Fact]
    public async Task Factory_UsesTempDatabaseAndNoSeq()
    {
        // Catches a test run touching the developer's database or exporting logs to the committed Seq endpoint.
        await Client.GetTasksAsync(Ct);

        var config = Harness.Factory.Services.GetRequiredService<IConfiguration>();
        var connection = config["ConnectionStrings:DefaultConnection"];
        Assert.Contains(Harness.Factory.DatabasePath, connection);
        Assert.StartsWith(Path.GetTempPath(), Harness.Factory.DatabasePath);
        Assert.DoesNotContain("localhost:5341", config["OpenTelemetry:Endpoint"]);
        Assert.True(string.IsNullOrEmpty(config["OpenTelemetry:Header"]));
        Assert.True(File.Exists(Harness.Factory.DatabasePath));
    }

    [Fact]
    public async Task Dispose_RemovesTemporaryDirectory()
    {
        // Catches a pooled SQLite connection leaving the temp database behind on every run.
        var harness = McpHarness.Create();
        var directory = harness.Factory.TempDirectory;
        await harness.Client.GetTasksAsync(Ct);
        Assert.True(Directory.Exists(directory));

        await harness.DisposeAsync();

        Assert.False(Directory.Exists(directory));
    }
}
