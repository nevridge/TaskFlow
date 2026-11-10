using Microsoft.Extensions.DependencyInjection;
using TaskFlow.Mcp.Api;
using TaskFlow.Mcp.Extensions;

namespace TaskFlow.Mcp.Integration.Tests.Infrastructure;

/// <summary>
/// The real MCP client registration (<c>AddTaskFlowApi</c>) wired to an in-process API host through the
/// test server's handler. One harness, one host, one database per test.
/// </summary>
public sealed class McpHarness : IAsyncDisposable
{
    private readonly TaskFlowApiFactory _factory;
    private readonly ServiceProvider _provider;

    private McpHarness(TaskFlowApiFactory factory, ServiceProvider provider, ResponseRecorder recorder, TaskFlowApiClient client)
    {
        _factory = factory;
        _provider = provider;
        Recorder = recorder;
        Client = client;
    }

    public TaskFlowApiClient Client { get; }

    public ResponseRecorder Recorder { get; }

    internal TaskFlowApiFactory Factory => _factory;

    internal static McpHarness Create()
    {
        var factory = new TaskFlowApiFactory();
        try
        {
            var recorder = new ResponseRecorder();
            var services = new ServiceCollection();
            services.AddTaskFlowApi(factory.Server.BaseAddress.ToString());
            services.AddHttpClient<TaskFlowApiClient>()
                .ConfigurePrimaryHttpMessageHandler(() => factory.Server.CreateHandler())
                .AddHttpMessageHandler(() => recorder);

            var provider = services.BuildServiceProvider();
            return new McpHarness(factory, provider, recorder, provider.GetRequiredService<TaskFlowApiClient>());
        }
        catch
        {
            factory.Dispose();
            throw;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _provider.DisposeAsync();
        await _factory.DisposeAsync();
    }
}
