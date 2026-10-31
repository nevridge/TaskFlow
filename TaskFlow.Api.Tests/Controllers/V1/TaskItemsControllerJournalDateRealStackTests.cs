using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Real SQLite stack tests for the optional <c>journalDate</c> on PUT/PATCH (issue #352): linking, moves,
/// atomic rollback and the duplicate-date race.
/// </summary>
public class TaskItemsControllerJournalDateRealStackTests
{
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private sealed class SpyJournalRepo(IJournalEntryRepository inner) : IJournalEntryRepository
    {
        public bool HideNextGetByDate { get; set; }
        public Func<int, int, int?, Task<AddTodoResult>>? AddTodoOverride { get; set; }

        public Task<IEnumerable<JournalEntry>> GetAllAsync() => inner.GetAllAsync();
        public Task<JournalEntry?> GetByIdAsync(int id) => inner.GetByIdAsync(id);

        public Task<JournalEntry?> GetByDateAsync(DateOnly date)
        {
            if (HideNextGetByDate)
            {
                // Simulates the stale miss of a concurrent create: the row exists but this read does not see it.
                HideNextGetByDate = false;
                return Task.FromResult<JournalEntry?>(null);
            }

            return inner.GetByDateAsync(date);
        }

        public Task<JournalEntry> AddAsync(JournalEntry entry) => inner.AddAsync(entry);
        public Task UpdateAsync(JournalEntry entry) => inner.UpdateAsync(entry);
        public Task DeleteAsync(int id) => inner.DeleteAsync(id);
        public Task<IEnumerable<TaskItem>> GetTodosAsync(int entryId) => inner.GetTodosAsync(entryId);
        public Task<bool> TodoExistsAsync(int entryId, int taskItemId) => inner.TodoExistsAsync(entryId, taskItemId);
        public Task<JournalDayTodos?> GetTodosForDayAsync(int entryId, int? offsetMinutes) => inner.GetTodosForDayAsync(entryId, offsetMinutes);
        public Task<IReadOnlyDictionary<int, List<int>>> GetTodoTaskItemIdsAsync(IReadOnlyCollection<(int EntryId, DateOnly Date)> entries, int? offsetMinutes) =>
            inner.GetTodoTaskItemIdsAsync(entries, offsetMinutes);
        public Task<PlanCompletedDetails?> GetPlanCompletedDetailsAsync(int entryId, int taskItemId) => inner.GetPlanCompletedDetailsAsync(entryId, taskItemId);

        public Task<AddTodoResult> AddTodoAsync(int entryId, int taskItemId, int? timezoneOffsetMinutes = null) =>
            AddTodoOverride is null
                ? inner.AddTodoAsync(entryId, taskItemId, timezoneOffsetMinutes)
                : AddTodoOverride(entryId, taskItemId, timezoneOffsetMinutes);

        public Task<bool> RemoveTodoAsync(int entryId, int taskItemId) => inner.RemoveTodoAsync(entryId, taskItemId);

        public Task<IReadOnlyList<int>> CarryForwardIncompleteTasksAsync(int entryId, DateOnly userToday) =>
            inner.CarryForwardIncompleteTasksAsync(entryId, userToday);
    }

    private sealed class Stack : IDisposable
    {
        private readonly SqliteConnection _connection;

        public Stack()
        {
            _connection = new SqliteConnection("DataSource=:memory:");
            _connection.Open();
            Context = new TaskDbContext(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options);
            Context.Database.EnsureCreated();
            Journal = new SpyJournalRepo(new JournalEntryRepository(Context));
            Controller = new TaskItemsController(
                new TaskRepository(Context),
                new TaskItemValidator(),
                Journal,
                new Moq.Mock<IProjectRepository>().Object,
                new CreateTaskItemDtoValidator(),
                new UpdateTaskItemDtoValidator(),
                new PatchTaskItemDtoValidator());
        }

        public TaskDbContext Context { get; }
        public SpyJournalRepo Journal { get; }
        public TaskItemsController Controller { get; }

        public async Task<TaskItem> SeedTaskAsync(TaskItem? item = null)
        {
            item ??= new TaskItem { Title = "Original", Status = Status.Todo, Priority = Priority.Low };
            Context.TaskItems.Add(item);
            await Context.SaveChangesAsync();
            Context.ChangeTracker.Clear();
            return item;
        }

        public async Task<JournalEntry> SeedEntryAsync(DateOnly date)
        {
            var entry = new JournalEntry { Title = $"J {date}", Date = date };
            Context.JournalEntries.Add(entry);
            await Context.SaveChangesAsync();
            Context.ChangeTracker.Clear();
            return entry;
        }

        /// <summary>Seeds a task already planned on <paramref name="date"/> (link, current entry, first tagged date).</summary>
        public async Task<(TaskItem Task, JournalEntry Entry)> SeedPlannedTaskAsync(DateOnly date)
        {
            var entry = new JournalEntry { Title = $"J {date}", Date = date };
            var task = new TaskItem
            {
                Title = "Original",
                Status = Status.Todo,
                Priority = Priority.Low,
                CurrentJournalEntry = entry,
                FirstTaggedDate = date
            };
            entry.Todos.Add(task);
            Context.JournalEntries.Add(entry);
            await Context.SaveChangesAsync();
            Context.ChangeTracker.Clear();
            return (task, entry);
        }

        public Task<TaskItem> ReloadAsync(int id) => Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);

        public Task<List<string>> EventTypesAsync(int taskId) =>
            Context.TaskItemEvents.Where(e => e.TaskItemId == taskId).OrderBy(e => e.Id).Select(e => e.EventType).ToListAsync();

        public Task<int> EntryCountAsync() => Context.JournalEntries.AsNoTracking().CountAsync();

        public async Task<List<int>> LinkedTaskIdsAsync(int entryId) =>
            (await Context.JournalEntries.AsNoTracking().Include(e => e.Todos).SingleAsync(e => e.Id == entryId))
                .Todos.Select(t => t.Id).ToList();

        public void Dispose()
        {
            Context.Dispose();
            _connection.Dispose();
        }
    }

    private static TaskItemResponseDto OkDto(ActionResult<TaskItemResponseDto> result) =>
        Assert.IsType<TaskItemResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static string ErrorCode(ActionResult<TaskItemResponseDto> result)
    {
        var value = Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;
        return (string)value.GetType().GetProperty("code")!.GetValue(value)!;
    }

    private static UpdateTaskItemDto Put(DateOnly? journalDate, string title = "Original", Status? status = null, int? offset = null) =>
        new() { Title = title, Status = status, JournalDate = journalDate, TimezoneOffsetMinutes = offset };

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CompleteAndPlanInOneRequest_OnOpenTask_Returns422AndRollsEverythingBack(bool usePut)
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();
        var future = Today.AddDays(2);
        var eventsBefore = await stack.EventTypesAsync(task.Id);

        var result = usePut
            ? await stack.Controller.Update(task.Id, Put(future, status: Status.Completed))
            : await stack.Controller.Patch(task.Id, new PatchTaskItemDto { Status = Status.Completed, JournalDate = future });

        Assert.Equal("TASK_PLAN_COMPLETED_NOT_ALLOWED", ErrorCode(result));
        var reloaded = await stack.ReloadAsync(task.Id);
        Assert.Equal(Status.Todo, reloaded.Status);
        Assert.Null(reloaded.CompletedAt);
        Assert.Null(reloaded.CurrentJournalEntryId);
        Assert.Equal(eventsBefore, await stack.EventTypesAsync(task.Id));
        Assert.Equal(0, await stack.EntryCountAsync());
    }

    [Fact]
    public async Task Put_FutureDateWithExistingEntry_LinksTaskAndShowsDayInResponse()
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();
        var future = Today.AddDays(2);
        var entry = await stack.SeedEntryAsync(future);

        var dto = OkDto(await stack.Controller.Update(task.Id, Put(future, title: "Renamed")));

        Assert.Equal("Renamed", dto.Title);
        Assert.Equal(future, dto.CurrentJournalDate);
        Assert.Equal(entry.Id, dto.CurrentJournalEntryId);
        Assert.Equal(0, dto.MoveCount);
        Assert.Equal(future, dto.FirstTaggedDate);
        var reloaded = await stack.ReloadAsync(task.Id);
        Assert.Equal("Renamed", reloaded.Title);
        Assert.Equal(entry.Id, reloaded.CurrentJournalEntryId);
        Assert.Equal([task.Id], await stack.LinkedTaskIdsAsync(entry.Id));
        var events = await stack.EventTypesAsync(task.Id);
        Assert.Contains("TitleChanged", events);
        Assert.Contains("AssignedToJournalDay", events);
    }

    [Fact]
    public async Task Patch_FutureDateWithMissingEntry_CreatesEntryAndLinks()
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();
        var future = Today.AddDays(1);

        var dto = OkDto(await stack.Controller.Patch(task.Id, new PatchTaskItemDto { JournalDate = future }));

        Assert.Equal(future, dto.CurrentJournalDate);
        Assert.Equal(0, dto.MoveCount);
        Assert.Equal(1, await stack.EntryCountAsync());
        Assert.Contains("AssignedToJournalDay", await stack.EventTypesAsync(task.Id));
    }

    [Fact]
    public async Task Put_MovesTaskBetweenDays_RemovesOldLinkAndIncrementsMoveCount()
    {
        using var stack = new Stack();
        var firstDay = Today.AddDays(1);
        var secondDay = Today.AddDays(3);
        var (task, oldEntry) = await stack.SeedPlannedTaskAsync(firstDay);

        var dto = OkDto(await stack.Controller.Update(task.Id, Put(secondDay)));

        Assert.Equal(secondDay, dto.CurrentJournalDate);
        Assert.Equal(1, dto.MoveCount);
        Assert.Equal(firstDay, dto.FirstTaggedDate);
        Assert.Empty(await stack.LinkedTaskIdsAsync(oldEntry.Id));
        Assert.Contains("ReassignedToJournalDay", await stack.EventTypesAsync(task.Id));
    }

    [Fact]
    public async Task Patch_ExplicitNullAndAbsentJournalDate_LeavePlannedDayUnchanged()
    {
        using var stack = new Stack();
        var day = Today.AddDays(2);
        var (task, entry) = await stack.SeedPlannedTaskAsync(day);

        var absent = OkDto(await stack.Controller.Patch(task.Id, new PatchTaskItemDto { Title = "A" }));
        var explicitNull = OkDto(await stack.Controller.Patch(task.Id, new PatchTaskItemDto { Title = "B", JournalDate = null }));

        Assert.Equal(day, absent.CurrentJournalDate);
        Assert.Equal(day, explicitNull.CurrentJournalDate);
        Assert.Equal(0, (await stack.ReloadAsync(task.Id)).MoveCount);
        Assert.Equal([task.Id], await stack.LinkedTaskIdsAsync(entry.Id));
        Assert.Equal(1, await stack.EntryCountAsync());
    }

    [Theory]
    [InlineData(2)]
    [InlineData(-3)]
    public async Task Put_SameDateAsCurrent_SucceedsAndAppliesOtherChanges_EvenForPastDay(int daysFromToday)
    {
        using var stack = new Stack();
        var day = Today.AddDays(daysFromToday);
        var (task, _) = await stack.SeedPlannedTaskAsync(day);

        var dto = OkDto(await stack.Controller.Update(task.Id, Put(day, title: "Renamed")));

        Assert.Equal("Renamed", dto.Title);
        Assert.Equal(day, dto.CurrentJournalDate);
        Assert.Equal(0, dto.MoveCount);
        Assert.DoesNotContain("AssignedToJournalDay", await stack.EventTypesAsync(task.Id));
        Assert.DoesNotContain("ReassignedToJournalDay", await stack.EventTypesAsync(task.Id));
    }

    [Fact]
    public async Task Put_PastDate_Returns422AndNothingChanged()
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();

        var result = await stack.Controller.Update(task.Id, Put(Today.AddDays(-1), title: "Renamed", status: Status.InProgress));

        Assert.Equal("TASK_CREATION_PAST_DAY_NOT_ALLOWED", ErrorCode(result));
        var reloaded = await stack.ReloadAsync(task.Id);
        Assert.Equal("Original", reloaded.Title);
        Assert.Equal(Status.Todo, reloaded.Status);
        Assert.Empty(await stack.EventTypesAsync(task.Id));
        Assert.Equal(0, await stack.EntryCountAsync());
    }

    [Fact]
    public async Task Patch_PastDate_Returns422AndNothingChanged()
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();

        var result = await stack.Controller.Patch(task.Id, new PatchTaskItemDto { Title = "Renamed", JournalDate = Today.AddDays(-2) });

        Assert.Equal("TASK_CREATION_PAST_DAY_NOT_ALLOWED", ErrorCode(result));
        Assert.Equal("Original", (await stack.ReloadAsync(task.Id)).Title);
        Assert.Empty(await stack.EventTypesAsync(task.Id));
        Assert.Equal(0, await stack.EntryCountAsync());
    }

    [Fact]
    public async Task Put_LinkReportsAlreadyLinkedAfterWriting_RollsBackFieldsEventsAndNewEntry()
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();
        var inner = new JournalEntryRepository(stack.Context);
        // Performs the real link (so rows exist inside the transaction), then reports a conflict.
        stack.Journal.AddTodoOverride = async (entryId, taskId, offset) =>
        {
            Assert.Equal(AddTodoResult.Success, await inner.AddTodoAsync(entryId, taskId, offset));
            return AddTodoResult.AlreadyLinked;
        };

        var result = await stack.Controller.Update(task.Id, Put(Today.AddDays(1), title: "Renamed"));

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var code = conflict.Value!.GetType().GetProperty("code")!.GetValue(conflict.Value);
        Assert.Equal("TASK_JOURNAL_ASSIGNMENT_CONFLICT", code);
        stack.Context.ChangeTracker.Clear();
        var reloaded = await stack.ReloadAsync(task.Id);
        Assert.Equal("Original", reloaded.Title);
        Assert.Null(reloaded.CurrentJournalEntryId);
        Assert.Empty(await stack.EventTypesAsync(task.Id));
        Assert.Equal(0, await stack.EntryCountAsync());
    }

    [Fact]
    public async Task Put_LinkThrows_RollsBackAndPropagates()
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();
        stack.Journal.AddTodoOverride = (_, _, _) => throw new InvalidOperationException("boom");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            stack.Controller.Update(task.Id, Put(Today.AddDays(1), title: "Renamed")));

        stack.Context.ChangeTracker.Clear();
        Assert.Equal("Original", (await stack.ReloadAsync(task.Id)).Title);
        Assert.Empty(await stack.EventTypesAsync(task.Id));
        Assert.Equal(0, await stack.EntryCountAsync());
    }

    [Fact]
    public async Task Put_DuplicateDateRace_StillLinksTask()
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();
        var future = Today.AddDays(2);
        var entry = await stack.SeedEntryAsync(future);
        stack.Journal.HideNextGetByDate = true;

        var dto = OkDto(await stack.Controller.Update(task.Id, Put(future)));

        Assert.Equal(future, dto.CurrentJournalDate);
        Assert.Equal(entry.Id, dto.CurrentJournalEntryId);
        Assert.Equal([task.Id], await stack.LinkedTaskIdsAsync(entry.Id));
        Assert.Equal(1, await stack.EntryCountAsync());
    }

    [Fact]
    public async Task Put_StatusChangeAndPlanning_AppliedInOneRequest()
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();
        var future = Today.AddDays(1);

        var dto = OkDto(await stack.Controller.Update(task.Id, Put(future, status: Status.InProgress)));

        Assert.Equal("InProgress", dto.Status);
        Assert.Equal(future, dto.CurrentJournalDate);
        var events = await stack.EventTypesAsync(task.Id);
        Assert.Contains("AssignedToJournalDay", events);
    }

    [Fact]
    public async Task Put_PlanningParent_DoesNotPlanChildren()
    {
        using var stack = new Stack();
        var parent = await stack.SeedTaskAsync();
        var child = await stack.SeedTaskAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });

        var dto = OkDto(await stack.Controller.Update(parent.Id, Put(Today.AddDays(1))));

        Assert.NotNull(dto.CurrentJournalDate);
        Assert.Equal(1, dto.ChildTaskCount);
        Assert.Null((await stack.ReloadAsync(child.Id)).CurrentJournalEntryId);
    }

    [Theory]
    [InlineData(841)]
    [InlineData(-721)]
    public async Task PutAndPatch_OffsetOutOfRangeWithJournalDate_Return400AndChangeNothing(int offset)
    {
        using var stack = new Stack();
        var task = await stack.SeedTaskAsync();

        var put = await stack.Controller.Update(task.Id, Put(Today.AddDays(1), title: "Renamed", offset: offset));
        var patch = await stack.Controller.Patch(task.Id, new PatchTaskItemDto { Title = "Renamed", JournalDate = Today.AddDays(1), TimezoneOffsetMinutes = offset });

        Assert.IsType<BadRequestObjectResult>(put.Result);
        Assert.IsType<BadRequestObjectResult>(patch.Result);
        Assert.Equal("Original", (await stack.ReloadAsync(task.Id)).Title);
        Assert.Empty(await stack.EventTypesAsync(task.Id));
        Assert.Equal(0, await stack.EntryCountAsync());
    }
}
