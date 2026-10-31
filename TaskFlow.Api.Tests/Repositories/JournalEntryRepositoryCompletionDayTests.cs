using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using TaskFlow.Api.Data;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

/// <summary>
/// The completion-day rule against real SQLite: CompletedAt is TEXT there, and its stored format is not uniform.
/// </summary>
public class JournalEntryRepositoryCompletionDayTests : IAsyncDisposable
{
    private static readonly DateOnly Mon = new(2090, 6, 1);
    private static readonly DateOnly Tue = new(2090, 6, 2);
    private static readonly DateOnly Wed = new(2090, 6, 3);
    private static readonly DateOnly Thu = new(2090, 6, 4);

    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly CommandCounter _counter = new();
    private readonly TaskDbContext _context;
    private readonly JournalEntryRepository _repo;

    public JournalEntryRepositoryCompletionDayTests()
    {
        _connection.Open();
        _context = new TaskDbContext(new DbContextOptionsBuilder<TaskDbContext>()
            .UseSqlite(_connection)
            .AddInterceptors(_counter)
            .Options);
        _context.Database.EnsureCreated();
        _repo = new JournalEntryRepository(_context);
    }

    public async ValueTask DisposeAsync()
    {
        await _context.DisposeAsync();
        await _connection.DisposeAsync();
    }

    private sealed class CommandCounter : DbCommandInterceptor
    {
        public int Count { get; set; }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Count++;
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    private async Task<JournalEntry> AddEntryAsync(DateOnly date)
    {
        var entry = new JournalEntry { Title = date.ToString("O"), Date = date, CreatedAt = DateTime.UtcNow };
        _context.JournalEntries.Add(entry);
        await _context.SaveChangesAsync();
        return entry;
    }

    private async Task<TaskItem> AddTaskAsync(
        Status status, int? linkedEntryId = null, string? completedAtText = null, int? parentId = null, string title = "t")
    {
        var task = new TaskItem { Title = title, Status = status, CurrentJournalEntryId = linkedEntryId, ParentTaskItemId = parentId };
        _context.TaskItems.Add(task);
        await _context.SaveChangesAsync();
        if (completedAtText is not null)
        {
            // Written as raw TEXT so the stored format is exactly what the test says.
            await _context.Database.ExecuteSqlInterpolatedAsync($"UPDATE TaskItems SET CompletedAt = {completedAtText} WHERE Id = {task.Id}");
        }

        _context.ChangeTracker.Clear();
        return task;
    }

    private static string Text(DateTime utc, string fractionalSuffix) => utc.ToString("yyyy-MM-dd HH:mm:ss") + fractionalSuffix;

    private static DateTime At(DateOnly day, int hour, int minute = 0, int second = 0) =>
        new(day.Year, day.Month, day.Day, hour, minute, second, DateTimeKind.Utc);

    // ---- AC1-AC4 on real storage ----

    [Fact]
    public async Task GetTodosForDayAsync_ShouldShowLinkedMonCompletedWedTaskOnWedOnly_WithItsOwnLinkedDay()
    {
        var mon = await AddEntryAsync(Mon);
        var wed = await AddEntryAsync(Wed);
        var task = await AddTaskAsync(Status.Completed, mon.Id, Text(At(Wed, 12), ".0000000"));

        var wedDay = await _repo.GetTodosForDayAsync(wed.Id, null);
        var monDay = await _repo.GetTodosForDayAsync(mon.Id, null);

        var row = Assert.Single(wedDay!.Tasks);
        Assert.Equal(task.Id, row.Id);
        Assert.Equal(Mon, row.CurrentJournalEntry!.Date);
        Assert.Empty(monDay!.Tasks);
    }

    [Fact]
    public async Task GetTodosForDayAsync_ShouldShowNeverLinkedCompletedTaskOnItsCompletionDayOnly()
    {
        var tue = await AddEntryAsync(Tue);
        var wed = await AddEntryAsync(Wed);
        var task = await AddTaskAsync(Status.Completed, null, Text(At(Wed, 8), ""));

        Assert.Equal(task.Id, Assert.Single((await _repo.GetTodosForDayAsync(wed.Id, null))!.Tasks).Id);
        Assert.Null(Assert.Single((await _repo.GetTodosForDayAsync(wed.Id, null))!.Tasks).CurrentJournalEntry);
        Assert.Empty((await _repo.GetTodosForDayAsync(tue.Id, null))!.Tasks);
    }

    [Fact]
    public async Task GetTodosForDayAsync_ShouldUseLinkedDay_ForCompletedTaskWithoutCompletedAt_AndForOpenTasks()
    {
        var mon = await AddEntryAsync(Mon);
        var wed = await AddEntryAsync(Wed);
        var legacy = await AddTaskAsync(Status.Completed, mon.Id);
        var open = await AddTaskAsync(Status.InProgress, mon.Id);

        var monIds = (await _repo.GetTodosForDayAsync(mon.Id, null))!.Tasks.Select(t => t.Id).Order();

        Assert.Equal(new[] { legacy.Id, open.Id }.Order(), monIds);
        Assert.Empty((await _repo.GetTodosForDayAsync(wed.Id, null))!.Tasks);
    }

    [Fact]
    public async Task GetTodosForDayAsync_ShouldReturnNull_WhenEntryMissing()
    {
        Assert.Null(await _repo.GetTodosForDayAsync(999, null));
    }

    [Fact]
    public async Task GetTodosForDayAsync_ShouldReturnSubtaskCompletedOnDayAsItsOwnRow_WithParentLoadedForContext()
    {
        var mon = await AddEntryAsync(Mon);
        var wed = await AddEntryAsync(Wed);
        var parent = await AddTaskAsync(Status.Todo, mon.Id, title: "parent");
        var child = await AddTaskAsync(Status.Completed, null, Text(At(Wed, 9), ".000"), parent.Id, "child");
        var otherDayChild = await AddTaskAsync(Status.Todo, mon.Id, null, parent.Id, "sibling");

        var wedTasks = (await _repo.GetTodosForDayAsync(wed.Id, null))!.Tasks;
        var monTasks = (await _repo.GetTodosForDayAsync(mon.Id, null))!.Tasks;

        var row = Assert.Single(wedTasks);
        Assert.Equal(child.Id, row.Id);
        Assert.Equal(parent.Id, row.ParentTaskItem!.Id);
        Assert.Equal(new[] { parent.Id, otherDayChild.Id }.Order(), monTasks.Select(t => t.Id).Order());
        // The shown parent still previews all of its subtasks (#349 data).
        Assert.Equal(2, monTasks.Single(t => t.Id == parent.Id).ChildTaskItems.Count);
    }

    // ---- range boundaries on mixed TEXT formats ----

    [Theory]
    [InlineData(null, "")]
    [InlineData(null, ".000")]
    [InlineData(null, ".0000000")]
    [InlineData(-300, "")]
    [InlineData(-300, ".000")]
    [InlineData(-300, ".0000000")]
    [InlineData(840, "")]
    [InlineData(840, ".000")]
    [InlineData(840, ".0000000")]
    public async Task RangeFilter_ShouldBeStartInclusiveAndEndExclusive_ForEveryStoredTextFormat(int? offset, string suffix)
    {
        var tue = await AddEntryAsync(Tue);
        var wed = await AddEntryAsync(Wed);
        var thu = await AddEntryAsync(Thu);
        var (start, end) = JournalDayRule.GetUtcRange(Wed, offset);
        var beforeStart = await AddTaskAsync(Status.Completed, null, Text(start.AddSeconds(-1), suffix), title: "before");
        var atStart = await AddTaskAsync(Status.Completed, null, Text(start, suffix), title: "start");
        var lastSecond = await AddTaskAsync(Status.Completed, null, Text(end.AddSeconds(-1), suffix), title: "last");
        var atEnd = await AddTaskAsync(Status.Completed, null, Text(end, suffix), title: "end");

        var wedIds = (await _repo.GetTodosForDayAsync(wed.Id, offset))!.Tasks.Select(t => t.Id).Order().ToList();
        var batched = await _repo.GetTodoTaskItemIdsAsync([(tue.Id, Tue), (wed.Id, Wed), (thu.Id, Thu)], offset);

        Assert.Equal(new[] { atStart.Id, lastSecond.Id }.Order(), wedIds);
        Assert.Equal(new[] { atStart.Id, lastSecond.Id }.Order(), batched[wed.Id].Order());
        Assert.Equal([beforeStart.Id], batched[tue.Id]);
        Assert.Equal([atEnd.Id], batched[thu.Id]);
    }

    [Fact]
    public async Task RangeFilter_ShouldKeepFirstAndLastSecondOfTheUtcDayOnThatDay()
    {
        var wed = await AddEntryAsync(Wed);
        var first = await AddTaskAsync(Status.Completed, null, Text(At(Wed, 0), ".0000000"), title: "first");
        var last = await AddTaskAsync(Status.Completed, null, Text(At(Wed, 23, 59, 59), ".9999999"), title: "last");

        var ids = (await _repo.GetTodosForDayAsync(wed.Id, null))!.Tasks.Select(t => t.Id).Order();

        Assert.Equal(new[] { first.Id, last.Id }.Order(), ids);
    }

    // ---- batched ids ----

    [Fact]
    public async Task GetTodoTaskItemIdsAsync_ShouldNotCrossContaminateEntries_AndReturnRootsOnly()
    {
        var mon = await AddEntryAsync(Mon);
        var tue = await AddEntryAsync(Tue);
        var wed = await AddEntryAsync(Wed);
        var openMon = await AddTaskAsync(Status.Todo, mon.Id, title: "openMon");
        var openTue = await AddTaskAsync(Status.Todo, tue.Id, title: "openTue");
        var linkedMonDoneWed = await AddTaskAsync(Status.Completed, mon.Id, Text(At(Wed, 3), ".0000000"), title: "movedByCompletion");
        var neverLinkedDoneTue = await AddTaskAsync(Status.Completed, null, Text(At(Tue, 3), ""), title: "doneTue");
        var parent = await AddTaskAsync(Status.Todo, wed.Id, title: "parentWed");
        await AddTaskAsync(Status.Todo, wed.Id, null, parent.Id, "childWed");
        await AddTaskAsync(Status.Completed, null, Text(At(Wed, 5), ""), parent.Id, "childDoneWed");

        var ids = await _repo.GetTodoTaskItemIdsAsync([(mon.Id, Mon), (tue.Id, Tue), (wed.Id, Wed)], null);

        Assert.Equal([openMon.Id], ids[mon.Id]);
        Assert.Equal(new[] { openTue.Id, neverLinkedDoneTue.Id }.Order(), ids[tue.Id].Order());
        Assert.Equal(new[] { parent.Id, linkedMonDoneWed.Id }.Order(), ids[wed.Id].Order());
    }

    [Fact]
    public async Task GetTodoTaskItemIdsAsync_ShouldReturnAKeyPerEntry_AndEmptyForNoEntries()
    {
        var wed = await AddEntryAsync(Wed);

        var ids = await _repo.GetTodoTaskItemIdsAsync([(wed.Id, Wed)], null);
        var none = await _repo.GetTodoTaskItemIdsAsync([], null);

        Assert.Empty(ids[wed.Id]);
        Assert.Empty(none);
    }

    [Fact]
    public async Task GetTodoTaskItemIdsAsync_ShouldRunOneQueryWhateverTheEntryCount()
    {
        var entries = new List<(int EntryId, DateOnly Date)>();
        for (var i = 0; i < 8; i++)
        {
            var date = Mon.AddDays(10 + i);
            var entry = await AddEntryAsync(date);
            entries.Add((entry.Id, date));
            await AddTaskAsync(Status.Todo, entry.Id, title: $"open{i}");
            await AddTaskAsync(Status.Completed, null, Text(At(date, 6), ".0000000"), title: $"done{i}");
        }

        _counter.Count = 0;
        var one = await _repo.GetTodoTaskItemIdsAsync(entries.Take(1).ToList(), -300);
        var oneCount = _counter.Count;
        _counter.Count = 0;
        var many = await _repo.GetTodoTaskItemIdsAsync(entries, -300);
        var manyCount = _counter.Count;

        Assert.Equal(1, oneCount);
        Assert.Equal(1, manyCount);
        Assert.Equal(8, many.Count);
        Assert.All(many.Values, v => Assert.Equal(2, v.Count));
        Assert.Equal(2, one.Single().Value.Count);
    }

    [Fact]
    public async Task GetTodosForDayAsync_ShouldRunAFixedNumberOfQueries()
    {
        var wed = await AddEntryAsync(Wed);
        for (var i = 0; i < 6; i++)
        {
            await AddTaskAsync(Status.Todo, wed.Id, title: $"open{i}");
        }

        _counter.Count = 0;
        var day = await _repo.GetTodosForDayAsync(wed.Id, null);

        Assert.Equal(6, day!.Tasks.Count);
        Assert.Equal(2, _counter.Count);
    }

    // ---- AddTodoAsync ----

    [Fact]
    public async Task AddTodoAsync_ShouldReturnTaskCompleted_AndLinkNothingAndWriteNoEvent_WhenTaskIsCompleted()
    {
        var future = await AddEntryAsync(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(3)));
        var done = await AddTaskAsync(Status.Completed, null, Text(DateTime.UtcNow.AddHours(-1), ".0000000"));

        var result = await _repo.AddTodoAsync(future.Id, done.Id);

        Assert.Equal(AddTodoResult.TaskCompleted, result);
        Assert.False(await _repo.TodoExistsAsync(future.Id, done.Id));
        Assert.Null((await _context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == done.Id)).CurrentJournalEntryId);
        Assert.Empty(await _context.TaskItemEvents.Where(e => e.TaskItemId == done.Id && e.EventType.Contains("JournalDay")).ToListAsync());
    }

    [Fact]
    public async Task AddTodoAsync_ShouldStillLink_WhenTaskIsCompletedWithoutCompletedAt()
    {
        var future = await AddEntryAsync(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(3)));
        var legacy = await AddTaskAsync(Status.Completed);

        var result = await _repo.AddTodoAsync(future.Id, legacy.Id);

        Assert.Equal(AddTodoResult.Success, result);
        Assert.True(await _repo.TodoExistsAsync(future.Id, legacy.Id));
    }

    [Fact]
    public async Task AddTodoAsync_ShouldCheckEntryAndTaskExistenceBeforeCompleted_AndCompletedBeforePastDay()
    {
        var past = await AddEntryAsync(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-5)));
        var done = await AddTaskAsync(Status.Completed, null, Text(DateTime.UtcNow.AddDays(-4), ""));

        Assert.Equal(AddTodoResult.EntryNotFound, await _repo.AddTodoAsync(12345, done.Id));
        Assert.Equal(AddTodoResult.TaskNotFound, await _repo.AddTodoAsync(past.Id, 12345));
        Assert.Equal(AddTodoResult.TaskCompleted, await _repo.AddTodoAsync(past.Id, done.Id));
    }

    [Fact]
    public async Task GetPlanCompletedDetailsAsync_ShouldReturnLinkAndCompletionFacts_OrNullWhenMissing()
    {
        var mon = await AddEntryAsync(Mon);
        var wed = await AddEntryAsync(Wed);
        var done = await AddTaskAsync(Status.Completed, mon.Id, Text(At(Tue, 10), ".0000000"));

        var details = await _repo.GetPlanCompletedDetailsAsync(wed.Id, done.Id);

        Assert.NotNull(details);
        Assert.Equal(Mon, details.AssignedDate);
        Assert.Equal(At(Tue, 10), details.CompletedAt);
        Assert.Equal(Wed, details.JournalDate);
        Assert.Null(await _repo.GetPlanCompletedDetailsAsync(999, done.Id));
        Assert.Null(await _repo.GetPlanCompletedDetailsAsync(wed.Id, 999));
    }

    // ---- unlinking and auto-complete ----

    [Fact]
    public async Task DeleteAsync_ShouldUnlinkTasks_YetCompletedTaskStillShowsOnItsCompletionDay()
    {
        var future = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(10));
        var linkedEntry = await AddEntryAsync(future);
        var completionDayEntry = await AddEntryAsync(future.AddDays(1));
        var task = await AddTaskAsync(Status.Todo);
        Assert.Equal(AddTodoResult.Success, await _repo.AddTodoAsync(linkedEntry.Id, task.Id));
        var tracked = await _context.TaskItems.SingleAsync(t => t.Id == task.Id);
        tracked.Status = Status.Completed;
        tracked.CompletedAt = At(future.AddDays(1), 9);
        await _context.SaveChangesAsync();
        _context.ChangeTracker.Clear();

        await _repo.DeleteAsync(linkedEntry.Id);
        _context.ChangeTracker.Clear();

        Assert.Null((await _context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == task.Id)).CurrentJournalEntryId);
        var ids = await _repo.GetTodoTaskItemIdsAsync([(completionDayEntry.Id, future.AddDays(1))], null);
        Assert.Equal([task.Id], ids[completionDayEntry.Id]);
        var day = await _repo.GetTodosForDayAsync(completionDayEntry.Id, null);
        var row = Assert.Single(day!.Tasks);
        Assert.Null(row.CurrentJournalEntry);
    }

    [Fact]
    public async Task ParentAutoComplete_ShouldStampParentWithTheLastChildsCompletionTime_AndShowParentOnThatDay()
    {
        var taskRepo = new TaskRepository(_context);
        var parent = new TaskItem { Title = "parent", Status = Status.Todo };
        _context.TaskItems.Add(parent);
        await _context.SaveChangesAsync();
        var child = new TaskItem { Title = "child", Status = Status.Todo, ParentTaskItemId = parent.Id };
        _context.TaskItems.Add(child);
        await _context.SaveChangesAsync();

        // Same sequence TaskItemsController.Update runs when the last open subtask completes.
        child.Status = Status.Completed;
        await taskRepo.UpdateAsync(child);
        parent.Status = Status.Completed;
        await taskRepo.UpdateAsync(parent);
        _context.ChangeTracker.Clear();

        var storedParent = await _context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == parent.Id);
        var storedChild = await _context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == child.Id);
        Assert.NotNull(storedParent.CompletedAt);
        Assert.NotNull(storedChild.CompletedAt);
        Assert.Equal(storedChild.CompletedAt.Value, storedParent.CompletedAt.Value, TimeSpan.FromSeconds(5));

        var parentDay = DateOnly.FromDateTime(storedParent.CompletedAt.Value);
        var entry = await AddEntryAsync(parentDay);
        var ids = await _repo.GetTodoTaskItemIdsAsync([(entry.Id, parentDay)], null);
        Assert.Contains(parent.Id, ids[entry.Id]);
        var day = await _repo.GetTodosForDayAsync(entry.Id, null);
        Assert.Contains(day!.Tasks, t => t.Id == parent.Id);
    }
}
