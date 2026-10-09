using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TaskFlow.Mcp.Extensions;

var builder = Host.CreateApplicationBuilder(args);

// stdout is the MCP protocol channel, so all logs must go to stderr.
builder.Logging.AddConsole(options => options.LogToStandardErrorThreshold = LogLevel.Trace);
builder.Logging.SetMinimumLevel(LogLevel.Warning);

builder.Services.AddTaskFlowApi(builder.Configuration[TaskFlowApiServiceExtensions.BaseUrlSetting]);
builder.Services
    .AddMcpServer()
    .WithStdioServerTransport()
    .WithToolsFromAssembly();

await builder.Build().RunAsync();
