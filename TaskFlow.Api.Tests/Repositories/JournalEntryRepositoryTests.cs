using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class JournalEntryRepositoryTests
{
    private static TaskDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    private static (TaskDbContext context, SqliteConnection connection) CreateSqliteContext()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new TaskDbContext(options);
        context.Database.EnsureCreated();
        return (context, connection);
    }

    [Fact]
    public async Task AddAndGetByDate_ShouldPersistEntry()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        await repo.AddAsync(new JournalEntry { Title = "May 10", Date = date });

        var found = await repo.GetByDateAsync(date);

        Assert.NotNull(found);
        Assert.Equal("May 10", found.Title);
        Assert.Equal(DateTime.UtcNow, found.CreatedAt, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task GetAll_ShouldReturnDescendingByDate()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        await repo.AddAsync(new JournalEntry { Title = "Older", Date = today.AddDays(1) });
        await repo.AddAsync(new JournalEntry { Title = "Newer", Date = today.AddDays(2) });

        var all = (await repo.GetAllAsync()).ToList();

        Assert.Equal(2, all.Count);
        Assert.Equal("Newer", all[0].Title);
    }

    [Fact]
    public async Task AddTodoAndRemoveTodo_ShouldManageLinks()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, task.Id);

        Assert.True(await repo.TodoExistsAsync(entry.Id, task.Id));
        Assert.Single(await repo.GetTodosAsync(entry.Id), t => t.Id == task.Id);

        await repo.RemoveTodoAsync(entry.Id, task.Id);

        Assert.False(await repo.TodoExistsAsync(entry.Id, task.Id));
        Assert.Null(task.CurrentJournalEntryId);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldStampOwnershipMetadata_OnFirstAssignment()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        var result = await repo.AddTodoAsync(entry.Id, task.Id);

        Assert.Equal(AddTodoResult.Success, result);
        Assert.Equal(entry.Id, task.CurrentJournalEntryId);
        Assert.Equal(entry.Date, task.FirstTaggedDate);
        Assert.Equal(0, task.MoveCount);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldMoveTaskBetweenEntries_AndIncrementMoveCount()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var firstEntry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = today.AddDays(1) });
        var secondEntry = await repo.AddAsync(new JournalEntry { Title = "May 11", Date = today.AddDays(2) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(firstEntry.Id, task.Id);
        var moveResult = await repo.AddTodoAsync(secondEntry.Id, task.Id);

        Assert.Equal(AddTodoResult.Success, moveResult);
        Assert.Equal(secondEntry.Id, task.CurrentJournalEntryId);
        Assert.Equal(firstEntry.Date, task.FirstTaggedDate);
        Assert.Equal(1, task.MoveCount);
        Assert.False(await repo.TodoExistsAsync(firstEntry.Id, task.Id));
        Assert.True(await repo.TodoExistsAsync(secondEntry.Id, task.Id));
    }

    [Fact]
    public async Task AddTodoAsync_ShouldReturnAlreadyLinked_WhenLinkExists()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, task.Id);
        var result = await repo.AddTodoAsync(entry.Id, task.Id);

        Assert.Equal(AddTodoResult.AlreadyLinked, result);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldReturnEntryNotFound_WhenEntryMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var result = await repo.AddTodoAsync(999, 1);

        Assert.Equal(AddTodoResult.EntryNotFound, result);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldReturnTaskNotFound_WhenTaskMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var result = await repo.AddTodoAsync(entry.Id, 999);

        Assert.Equal(AddTodoResult.TaskNotFound, result);
    }

    [Fact]
    public async Task AddAsync_ShouldThrowDuplicateJournalDateException_WhenDateAlreadyExists()
    {
        var (context, connection) = CreateSqliteContext();
        await using var _ = connection;
        await using var __ = context;

        var repo = new JournalEntryRepository(context);
        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        await repo.AddAsync(new JournalEntry { Title = "First", Date = date });

        var act = async () => await repo.AddAsync(new JournalEntry { Title = "Duplicate", Date = date });

        await Assert.ThrowsAsync<DuplicateJournalDateException>(act);
    }

    [Fact]
    public async Task Delete_ShouldRemoveEntry_AndIgnoreMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "Delete", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });

        await repo.DeleteAsync(entry.Id);
        await repo.DeleteAsync(999);

        Assert.Null(await repo.GetByIdAsync(entry.Id));
    }

    [Fact]
    public async Task AddAsync_ShouldNotMoveAnyTasks_WhenCreatingFutureOrPastEntry()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var today = new DateOnly(2026, 10, 13);
        var (source, task) = await SeedLinkedTaskAsync(context, today.AddDays(-1));

        var future = await repo.AddAsync(new JournalEntry { Title = "Future", Date = today.AddDays(1) });
        var past = await repo.AddAsync(new JournalEntry { Title = "Past", Date = today.AddDays(-5) });

        Assert.Single(await repo.GetTodosAsync(source.Id), t => t.Id == task.Id);
        Assert.Empty(await repo.GetTodosAsync(future.Id));
        Assert.Empty(await repo.GetTodosAsync(past.Id));
        Assert.Equal(source.Id, task.CurrentJournalEntryId);
        Assert.Equal(0, task.MoveCount);
        Assert.Empty(context.TaskItemEvents);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldLeaveCompletedTasksInPlace()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (source, open) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var done = await LinkNewTaskAsync(context, source, new TaskItem { Title = "Done", Status = Status.Completed, IsComplete = true });
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        var moved = await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        Assert.Equal(new[] { open.Id }, moved);
        Assert.Single(await repo.GetTodosAsync(target.Id), t => t.Id == open.Id);
        Assert.Single(await repo.GetTodosAsync(source.Id), t => t.Id == done.Id);
        Assert.Equal(source.Id, done.CurrentJournalEntryId);
        Assert.Equal(0, done.MoveCount);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldMoveTasksFromAllEarlierEntries_WhenDatesHaveGaps()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (older, olderTask) = await SeedLinkedTaskAsync(context, today.AddDays(-6));
        var (newer, newerTask) = await SeedLinkedTaskAsync(context, today.AddDays(-3));
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        var moved = await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        Assert.Equal(new[] { olderTask.Id, newerTask.Id }, moved);
        Assert.Equal(new[] { olderTask.Id, newerTask.Id }.Order(), (await repo.GetTodosAsync(target.Id)).Select(t => t.Id).Order());
        Assert.Empty(await repo.GetTodosAsync(older.Id));
        Assert.Empty(await repo.GetTodosAsync(newer.Id));
        Assert.Equal(older.Date, olderTask.FirstTaggedDate);
        Assert.Equal(newer.Date, newerTask.FirstTaggedDate);
    }

    [Fact]
    public async Task AddTodoAsync_AndRemoveTodoAsync_ShouldWriteTaskHistoryEvents()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, task.Id);
        await repo.RemoveTodoAsync(entry.Id, task.Id);

        var events = await context.TaskItemEvents
            .Where(e => e.TaskItemId == task.Id)
            .OrderBy(e => e.OccurredAtUtc)
            .ToListAsync();

        Assert.Equal(2, events.Count);
        Assert.Equal("AssignedToJournalDay", events[0].EventType);
        Assert.Equal(entry.Id, events[0].ToJournalEntryId);
        Assert.Equal("RemovedFromJournalDay", events[1].EventType);
        Assert.Equal(entry.Id, events[1].FromJournalEntryId);
    }

    // Verifies the GetAllAsync include chain specifically — the controller path uses GetTodosAsync,
    // which is covered by GetTodosAsync_ShouldIncludeChildTaskItems_WhenParentIsInEntry.
    [Fact]
    public async Task GetAllAsync_ShouldIncludeChildTaskItems_OnTodos()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var parent = new TaskItem { Title = "Parent", Status = Status.Todo };
        context.TaskItems.Add(parent);
        await context.SaveChangesAsync();

        var child = new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id };
        context.TaskItems.Add(child);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, parent.Id);

        var all = (await repo.GetAllAsync()).ToList();

        var foundEntry = all.First(e => e.Id == entry.Id);
        var parentTodo = foundEntry.Todos.First(t => t.Id == parent.Id);
        Assert.Single(parentTodo.ChildTaskItems, c => c.Id == child.Id);
    }

    [Fact]
    public async Task GetTodosAsync_ShouldIncludeChildTaskItems_WhenParentIsInEntry()
    {
        var (context, connection) = CreateSqliteContext();
        await using var _ = connection;
        await using var __ = context;

        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var parent = new TaskItem { Title = "Parent", Status = Status.Todo };
        context.TaskItems.Add(parent);
        await context.SaveChangesAsync();

        var child = new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id };
        context.TaskItems.Add(child);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, parent.Id);

        var todos = (await repo.GetTodosAsync(entry.Id)).ToList();

        var parentTodo = todos.First(t => t.Id == parent.Id);
        Assert.Single(parentTodo.ChildTaskItems, c => c.Id == child.Id);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldIncludeChildTaskItems_OnTodos()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var parent = new TaskItem { Title = "Parent", Status = Status.Todo };
        context.TaskItems.Add(parent);
        await context.SaveChangesAsync();

        var child = new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id };
        context.TaskItems.Add(child);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, parent.Id);

        var found = await repo.GetByIdAsync(entry.Id);

        Assert.NotNull(found);
        var parentTodo = found.Todos.First(t => t.Id == parent.Id);
        Assert.Single(parentTodo.ChildTaskItems, c => c.Id == child.Id);
    }

    [Fact]
    public async Task GetByDateAsync_ShouldIncludeChildTaskItems_OnTodos()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = date });
        var parent = new TaskItem { Title = "Parent", Status = Status.Todo };
        context.TaskItems.Add(parent);
        await context.SaveChangesAsync();

        var child = new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id };
        context.TaskItems.Add(child);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, parent.Id);

        var found = await repo.GetByDateAsync(date);

        Assert.NotNull(found);
        var parentTodo = found.Todos.First(t => t.Id == parent.Id);
        Assert.Single(parentTodo.ChildTaskItems, c => c.Id == child.Id);
    }

    [Fact]
    public async Task GetTodosAsync_ShouldNestChild_WhenBothParentAndChildLinkedToSameEntry()
    {
        // Use a shared SQLite connection so two separate context instances share the same DB.
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        await using var _ = connection;

        int entryId;
        int parentId;
        int childId;

        // Write phase: use a dedicated write context so it is disposed before the read context opens.
        // This ensures no tracked instances leak into the read context's identity map.
        {
            var writeOptions = new DbContextOptionsBuilder<TaskDbContext>()
                .UseSqlite(connection)
                .Options;
            await using var writeContext = new TaskDbContext(writeOptions);
            writeContext.Database.EnsureCreated();

            var writeRepo = new JournalEntryRepository(writeContext);
            var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
            var entry = await writeRepo.AddAsync(new JournalEntry { Title = "Entry", Date = date });
            entryId = entry.Id;

            var parent = new TaskItem { Title = "Parent", Status = Status.Todo };
            writeContext.TaskItems.Add(parent);
            await writeContext.SaveChangesAsync();
            parentId = parent.Id;

            var child = new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id };
            writeContext.TaskItems.Add(child);
            await writeContext.SaveChangesAsync();
            childId = child.Id;

            // Link both parent AND child to the same entry — this is the identity map collision scenario.
            await writeRepo.AddTodoAsync(entryId, parentId);
            await writeRepo.AddTodoAsync(entryId, childId);
        }

        // Read phase: fresh context with an empty identity map — this is where the collision occurs
        // without AsNoTracking, because EF loads child both as a direct Todo and as a ChildTaskItem.
        var readOptions = new DbContextOptionsBuilder<TaskDbContext>()
            .UseSqlite(connection)
            .Options;
        await using var readContext = new TaskDbContext(readOptions);
        var readRepo = new JournalEntryRepository(readContext);

        var todos = (await readRepo.GetTodosAsync(entryId)).ToList();

        // Assert 1: the returned list contains both items (both linked to the same entry),
        // but only the parent qualifies as a root-level item (ParentTaskItemId is null).
        // Without AsNoTracking, the identity map collision causes the child's ParentTaskItemId
        // to read as null, which makes it falsely appear as a root item in the controller filter.
        var rootItems = todos.Where(t => t.ParentTaskItemId is null).ToList();
        Assert.Single(rootItems, t => t.Id == parentId);

        // Assert 2: the parent has exactly one child with the expected Id.
        var parentTodo = todos.First(t => t.Id == parentId);
        Assert.Single(parentTodo.ChildTaskItems, c => c.Id == childId);

        // Assert 3: the child's ParentTaskItemId is not null and correctly points to the parent.
        // This is the key assertion: without AsNoTracking this would be null due to identity map collision.
        var childItem = parentTodo.ChildTaskItems.First(c => c.Id == childId);
        Assert.NotNull(childItem.ParentTaskItemId);
        Assert.Equal(parentId, childItem.ParentTaskItemId);
    }

    [Fact]
    public async Task GetTodosAsync_ShouldIncludeCurrentJournalEntry_OnChildTaskItems()
    {
        var (context, connection) = CreateSqliteContext();
        await using var _ = connection;
        await using var __ = context;

        var repo = new JournalEntryRepository(context);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var firstEntry = await repo.AddAsync(new JournalEntry { Title = "First", Date = today.AddDays(1) });
        var secondEntry = await repo.AddAsync(new JournalEntry { Title = "Second", Date = today.AddDays(2) });

        var parent = new TaskItem { Title = "Parent", Status = Status.Todo };
        context.TaskItems.Add(parent);
        await context.SaveChangesAsync();

        var child = new TaskItem
        {
            Title = "Child",
            Status = Status.Todo,
            ParentTaskItemId = parent.Id,
            CurrentJournalEntryId = secondEntry.Id
        };
        context.TaskItems.Add(child);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(firstEntry.Id, parent.Id);

        var todos = (await repo.GetTodosAsync(firstEntry.Id)).ToList();

        var parentTodo = todos.First(t => t.Id == parent.Id);
        var childItem = parentTodo.ChildTaskItems.First(c => c.Id == child.Id);
        Assert.NotNull(childItem.CurrentJournalEntry);
        Assert.Equal(secondEntry.Id, childItem.CurrentJournalEntry.Id);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldSetCountersAndEvents_ForEachMovedTask()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (a, taskA) = await SeedLinkedTaskAsync(context, today.AddDays(-4));
        var (b, taskB) = await SeedLinkedTaskAsync(context, today.AddDays(-2));
        taskB.FirstTaggedDate = today.AddDays(-9);
        taskB.MoveCount = 2;
        await context.SaveChangesAsync();
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        var moved = await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        Assert.Equal(new[] { taskA.Id, taskB.Id }, moved);
        Assert.Equal(target.Id, taskA.CurrentJournalEntryId);
        Assert.Equal(1, taskA.MoveCount);
        Assert.Equal(a.Date, taskA.FirstTaggedDate);
        Assert.Equal(3, taskB.MoveCount);
        Assert.Equal(today.AddDays(-9), taskB.FirstTaggedDate);
        var events = context.TaskItemEvents.ToList();
        Assert.Equal(2, events.Count);
        Assert.All(events, e => Assert.True(e.EventType == "ReassignedToJournalDay"
            && e.ChangeSummary == "Automatically moved forward to the next journal day."
            && e.ToJournalEntryId == target.Id && e.ToJournalDate == today));
        Assert.Equal(a.Id, events.Single(e => e.TaskItemId == taskA.Id).FromJournalEntryId);
        Assert.Equal(a.Date, events.Single(e => e.TaskItemId == taskA.Id).FromJournalDate);
        Assert.Equal(b.Id, events.Single(e => e.TaskItemId == taskB.Id).FromJournalEntryId);
        Assert.Equal(b.Date, events.Single(e => e.TaskItemId == taskB.Id).FromJournalDate);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldRespectStatusAndIsCompleteIndependently()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (source, openTask) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var statusOnly = await LinkNewTaskAsync(context, source, new TaskItem { Title = "S", Status = Status.Completed, IsComplete = false });
        var flagOnly = await LinkNewTaskAsync(context, source, new TaskItem { Title = "F", Status = Status.Todo, IsComplete = true });
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        var moved = await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        Assert.Equal(new[] { openTask.Id }, moved);
        Assert.Equal(source.Id, statusOnly.CurrentJournalEntryId);
        Assert.Equal(source.Id, flagOnly.CurrentJournalEntryId);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldNotTouchPlannedDayBetween_AndReachStrandedTasks()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (a, taskA) = await SeedLinkedTaskAsync(context, today.AddDays(-5));
        var (_, taskFuture) = await SeedLinkedTaskAsync(context, today.AddDays(2));
        var target = await repo.AddAsync(new JournalEntry { Title = "C", Date = today });
        var orphan = new TaskItem { Title = "Orphan", Status = Status.Todo };
        context.TaskItems.Add(orphan);
        await context.SaveChangesAsync();

        var moved = await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        Assert.Equal(new[] { taskA.Id }, moved);
        Assert.Equal(target.Id, taskA.CurrentJournalEntryId);
        Assert.Empty(await repo.GetTodosAsync(a.Id));
        Assert.Equal(0, taskFuture.MoveCount);
        Assert.NotEqual(target.Id, taskFuture.CurrentJournalEntryId);
        Assert.Null(orphan.CurrentJournalEntryId);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldCarryIntoPreExistingTodayEntry()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var target = await repo.AddAsync(new JournalEntry { Title = "Planned earlier", Date = today });
        var existing = await LinkNewTaskAsync(context, target, new TaskItem { Title = "Already here", Status = Status.Todo });
        var (_, old) = await SeedLinkedTaskAsync(context, today.AddDays(-2));

        var moved = await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        Assert.Equal(new[] { old.Id }, moved);
        Assert.Equal(new[] { existing.Id, old.Id }.Order(), (await repo.GetTodosAsync(target.Id)).Select(t => t.Id).Order());
        Assert.Equal(0, existing.MoveCount);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldBeIdempotent_WhenRunTwice()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (_, task) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        Assert.Equal(new[] { task.Id }, (await repo.CarryForwardIncompleteTasksAsync(target.Id, today)));
        Assert.Empty(await repo.CarryForwardIncompleteTasksAsync(target.Id, today));

        Assert.Equal(1, task.MoveCount);
        Assert.Single(context.TaskItemEvents);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldNotPullBackTaskCompletedOrRemovedAfterCarry()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (_, completedLater) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var (_, removedLater) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });
        await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        completedLater.Status = Status.Completed;
        completedLater.IsComplete = true;
        await context.SaveChangesAsync();
        await repo.RemoveTodoAsync(target.Id, removedLater.Id);

        Assert.Empty(await repo.CarryForwardIncompleteTasksAsync(target.Id, today));
        Assert.Equal(target.Id, completedLater.CurrentJournalEntryId);
        Assert.Null(removedLater.CurrentJournalEntryId);
        Assert.Equal(1, completedLater.MoveCount);
        Assert.Equal(1, removedLater.MoveCount);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldMoveSubTasksIndependentlyOfParent()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (source, _) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var doneParent = await LinkNewTaskAsync(context, source, new TaskItem { Title = "Parent", Status = Status.Completed, IsComplete = true });
        var openChild = await LinkNewTaskAsync(context, source, new TaskItem { Title = "Open child", Status = Status.Todo, ParentTaskItemId = doneParent.Id });
        var doneChild = await LinkNewTaskAsync(context, source, new TaskItem { Title = "Done child", Status = Status.Completed, IsComplete = true, ParentTaskItemId = doneParent.Id });
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        Assert.Equal(target.Id, openChild.CurrentJournalEntryId);
        Assert.Equal(source.Id, doneChild.CurrentJournalEntryId);
        Assert.Equal(source.Id, doneParent.CurrentJournalEntryId);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldReturnZero_WhenTargetIsNotUserToday()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (_, task) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var tomorrow = await repo.AddAsync(new JournalEntry { Title = "Tomorrow", Date = today.AddDays(1) });

        Assert.Empty(await repo.CarryForwardIncompleteTasksAsync(tomorrow.Id, today));

        Assert.Equal(0, task.MoveCount);
        Assert.Empty(context.TaskItemEvents);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldReturnZero_WhenEntryMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        Assert.Empty(await repo.CarryForwardIncompleteTasksAsync(999, new DateOnly(2026, 10, 13)));
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldReturnEmpty_WhenNoIncompleteEarlierTasks()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (_, seeded) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        seeded.Status = Status.Completed;
        seeded.IsComplete = true;
        await context.SaveChangesAsync();
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        Assert.Empty(await repo.CarryForwardIncompleteTasksAsync(target.Id, today));
        Assert.Empty(context.TaskItemEvents);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldReturnAllIdsInSourceDateThenIdOrder_ForManyTasks()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (older, olderFirst) = await SeedLinkedTaskAsync(context, today.AddDays(-5));
        var (newer, newerFirst) = await SeedLinkedTaskAsync(context, today.AddDays(-2));
        var expectedOlder = new List<int> { olderFirst.Id };
        var expectedNewer = new List<int> { newerFirst.Id };
        for (var i = 0; i < 24; i++)
        {
            // Interleave creation so task Id order differs from source date order.
            expectedNewer.Add((await LinkNewTaskAsync(context, newer, new TaskItem { Title = $"N{i}", Status = Status.Todo })).Id);
            expectedOlder.Add((await LinkNewTaskAsync(context, older, new TaskItem { Title = $"O{i}", Status = Status.Todo })).Id);
        }

        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        var moved = await repo.CarryForwardIncompleteTasksAsync(target.Id, today);

        Assert.Equal(50, moved.Count());
        Assert.Equal(expectedOlder.Order().Concat(expectedNewer.Order()), moved);
        Assert.Equal(moved.Count, context.TaskItemEvents.Count(e => e.EventType == "ReassignedToJournalDay"));
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldReturnZeroAndRollBack_WhenConcurrentRequestAlreadyLinkedTask()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        await using var _ = connection;
        var today = new DateOnly(2026, 10, 13);

        var seedOptions = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(connection).Options;
        int targetId;
        int taskId;
        int sourceId;
        await using (var seed = new TaskDbContext(seedOptions))
        {
            seed.Database.EnsureCreated();
            var (source, task) = await SeedLinkedTaskAsync(seed, today.AddDays(-1));
            var target = await new JournalEntryRepository(seed).AddAsync(new JournalEntry { Title = "Today", Date = today });
            targetId = target.Id;
            taskId = task.Id;
            sourceId = source.Id;
        }

        // Simulate the competing request: its join row lands after our reads but before our save.
        var interceptor = new InsertJoinRowInterceptor(targetId, taskId);
        var options = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(connection).AddInterceptors(interceptor).Options;
        await using (var loser = new TaskDbContext(options))
        {
            var moved = await new JournalEntryRepository(loser).CarryForwardIncompleteTasksAsync(targetId, today);
            Assert.Empty(moved);
        }

        Assert.True(interceptor.Fired);
        await using var verify = new TaskDbContext(seedOptions);
        var reloaded = await verify.TaskItems.SingleAsync(t => t.Id == taskId);
        Assert.Equal(0, reloaded.MoveCount);
        Assert.Equal(sourceId, reloaded.CurrentJournalEntryId);
        Assert.Equal(0, (await verify.TaskItemEvents.CountAsync()));
    }

    private sealed class InsertJoinRowInterceptor(int entryId, int taskId) : SaveChangesInterceptor
    {
        public bool Fired { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!Fired)
            {
                Fired = true;
                await eventData.Context!.Database.ExecuteSqlAsync(
                    $"INSERT INTO JournalEntryTaskItem (JournalEntryId, TodosId) VALUES ({entryId}, {taskId})", cancellationToken);
            }

            return result;
        }
    }

    private static async Task<(JournalEntry entry, TaskItem task)> SeedLinkedTaskAsync(TaskDbContext context, DateOnly date)
    {
        var entry = new JournalEntry { Title = $"Entry {date}", Date = date, CreatedAt = DateTime.UtcNow };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();
        var task = await LinkNewTaskAsync(context, entry, new TaskItem { Title = $"Open {date}", Status = Status.Todo });
        return (entry, task);
    }

    private static async Task<TaskItem> LinkNewTaskAsync(TaskDbContext context, JournalEntry entry, TaskItem task)
    {
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();
        task.CurrentJournalEntryId = entry.Id;
        entry.Todos.Add(task);
        await context.SaveChangesAsync();
        return task;
    }
}
