using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Extensions;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;
using MvcJsonOptions = Microsoft.AspNetCore.Mvc.JsonOptions;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Proves a legacy client's stale <c>isComplete</c> is ignored (never a 400) on POST, PUT and PATCH.
/// The raw JSON is deserialized with the MVC <see cref="MvcJsonOptions"/> resolved from a service collection
/// built with the app's own <c>AddControllers()</c> + <c>ConfigureJsonSerialization()</c>, then the DTOs go through
/// the real controller, repository, validator and SQLite. Model binding itself (the input formatter that calls
/// System.Text.Json with these options) is not exercised; no WebApplicationFactory harness is used.
/// </summary>
public class TaskItemsControllerLegacyIsCompleteTests
{
    private static JsonSerializerOptions AppMvcJsonOptions()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddControllers();
        services.ConfigureJsonSerialization();
        using var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<IOptions<MvcJsonOptions>>().Value.JsonSerializerOptions;
    }

    private sealed class Stack : IDisposable
    {
        private readonly SqliteConnection _connection = new("DataSource=:memory:");

        public Stack()
        {
            _connection.Open();
            Context = new TaskDbContext(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options);
            Context.Database.EnsureCreated();
            Controller = new TaskItemsController(
                new TaskRepository(Context),
                new TaskItemValidator(),
                new JournalEntryRepository(Context),
                new Mock<IProjectRepository>().Object,
                new CreateTaskItemDtoValidator(),
                new UpdateTaskItemDtoValidator(),
                new PatchTaskItemDtoValidator());
        }

        public TaskDbContext Context { get; }
        public TaskItemsController Controller { get; }

        public async Task<int> SeedAsync(Status status)
        {
            var item = new TaskItem { Title = "Seed", Status = status };
            Context.TaskItems.Add(item);
            await Context.SaveChangesAsync();
            Context.ChangeTracker.Clear();
            return item.Id;
        }

        public async Task<Status> StatusOfAsync(int id)
        {
            Context.ChangeTracker.Clear();
            return (await Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id)).Status;
        }

        public void Dispose()
        {
            Context.Dispose();
            _connection.Dispose();
        }
    }

    [Fact]
    public void AppMvcJsonOptions_ShouldSkipUnmappedMembers()
    {
        var options = AppMvcJsonOptions();

        Assert.Equal(JsonUnmappedMemberHandling.Skip, options.UnmappedMemberHandling);
    }

    [Theory]
    [InlineData("""{"title":"x","status":"todo","isComplete":true}""", Status.Todo)]
    [InlineData("""{"title":"x","status":"completed","isComplete":false}""", Status.Completed)]
    public async Task Create_ShouldFollowStatusOnly_WhenLegacyIsCompleteSent(string json, Status expected)
    {
        using var stack = new Stack();
        var dto = JsonSerializer.Deserialize<CreateTaskItemDto>(json, AppMvcJsonOptions())!;

        var result = await stack.Controller.Create(dto);

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var body = Assert.IsType<TaskItemResponseDto>(created.Value);
        Assert.Equal(expected.ToString(), body.Status);
        Assert.Equal(expected, await stack.StatusOfAsync(body.Id));
    }

    [Theory]
    [InlineData("""{"title":"x","status":"todo","isComplete":true}""", Status.Todo, Status.Completed)]
    [InlineData("""{"title":"x","status":"completed","isComplete":false}""", Status.Completed, Status.Todo)]
    public async Task Update_ShouldFollowStatusOnly_WhenLegacyIsCompleteSent(string json, Status expected, Status seeded)
    {
        using var stack = new Stack();
        var id = await stack.SeedAsync(seeded);
        var dto = JsonSerializer.Deserialize<UpdateTaskItemDto>(json, AppMvcJsonOptions())!;

        var result = await stack.Controller.Update(id, dto);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(expected, await stack.StatusOfAsync(id));
    }

    [Theory]
    [InlineData("""{"title":"x","status":"todo","isComplete":true}""", Status.Todo, Status.Completed)]
    [InlineData("""{"title":"x","status":"completed","isComplete":false}""", Status.Completed, Status.Todo)]
    public async Task Patch_ShouldFollowStatusOnly_WhenLegacyIsCompleteSent(string json, Status expected, Status seeded)
    {
        using var stack = new Stack();
        var id = await stack.SeedAsync(seeded);
        var dto = JsonSerializer.Deserialize<PatchTaskItemDto>(json, AppMvcJsonOptions())!;

        var result = await stack.Controller.Patch(id, dto);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(expected, await stack.StatusOfAsync(id));
    }
}
