using FluentAssertions;
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

        found.Should().NotBeNull();
        found!.Title.Should().Be("May 10");
        found.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
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

        all.Should().HaveCount(2);
        all[0].Title.Should().Be("Newer");
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

        (await repo.TodoExistsAsync(entry.Id, task.Id)).Should().BeTrue();
        (await repo.GetTodosAsync(entry.Id)).Should().ContainSingle(t => t.Id == task.Id);

        await repo.RemoveTodoAsync(entry.Id, task.Id);

        (await repo.TodoExistsAsync(entry.Id, task.Id)).Should().BeFalse();
        task.CurrentJournalEntryId.Should().BeNull();
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

        result.Should().Be(AddTodoResult.Success);
        task.CurrentJournalEntryId.Should().Be(entry.Id);
        task.FirstTaggedDate.Should().Be(entry.Date);
        task.MoveCount.Should().Be(0);
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

        moveResult.Should().Be(AddTodoResult.Success);
        task.CurrentJournalEntryId.Should().Be(secondEntry.Id);
        task.FirstTaggedDate.Should().Be(firstEntry.Date);
        task.MoveCount.Should().Be(1);
        (await repo.TodoExistsAsync(firstEntry.Id, task.Id)).Should().BeFalse();
        (await repo.TodoExistsAsync(secondEntry.Id, task.Id)).Should().BeTrue();
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

        result.Should().Be(AddTodoResult.AlreadyLinked);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldReturnEntryNotFound_WhenEntryMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var result = await repo.AddTodoAsync(999, 1);

        result.Should().Be(AddTodoResult.EntryNotFound);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldReturnTaskNotFound_WhenTaskMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var result = await repo.AddTodoAsync(entry.Id, 999);

        result.Should().Be(AddTodoResult.TaskNotFound);
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

        await act.Should().ThrowAsync<DuplicateJournalDateException>();
    }

    [Fact]
    public async Task Delete_ShouldRemoveEntry_AndIgnoreMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "Delete", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });

        await repo.DeleteAsync(entry.Id);
        await repo.DeleteAsync(999);

        (await repo.GetByIdAsync(entry.Id)).Should().BeNull();
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

        (await repo.GetTodosAsync(source.Id)).Should().ContainSingle(t => t.Id == task.Id);
        (await repo.GetTodosAsync(future.Id)).Should().BeEmpty();
        (await repo.GetTodosAsync(past.Id)).Should().BeEmpty();
        task.CurrentJournalEntryId.Should().Be(source.Id);
        task.MoveCount.Should().Be(0);
        context.TaskItemEvents.Should().BeEmpty();
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

        moved.Should().Equal(open.Id);
        (await repo.GetTodosAsync(target.Id)).Should().ContainSingle(t => t.Id == open.Id);
        (await repo.GetTodosAsync(source.Id)).Should().ContainSingle(t => t.Id == done.Id);
        done.CurrentJournalEntryId.Should().Be(source.Id);
        done.MoveCount.Should().Be(0);
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

        moved.Should().Equal(olderTask.Id, newerTask.Id);
        (await repo.GetTodosAsync(target.Id)).Select(t => t.Id).Should().BeEquivalentTo([olderTask.Id, newerTask.Id]);
        (await repo.GetTodosAsync(older.Id)).Should().BeEmpty();
        (await repo.GetTodosAsync(newer.Id)).Should().BeEmpty();
        olderTask.FirstTaggedDate.Should().Be(older.Date);
        newerTask.FirstTaggedDate.Should().Be(newer.Date);
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

        events.Should().HaveCount(2);
        events[0].EventType.Should().Be("AssignedToJournalDay");
        events[0].ToJournalEntryId.Should().Be(entry.Id);
        events[1].EventType.Should().Be("RemovedFromJournalDay");
        events[1].FromJournalEntryId.Should().Be(entry.Id);
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
        parentTodo.ChildTaskItems.Should().ContainSingle(c => c.Id == child.Id);
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
        parentTodo.ChildTaskItems.Should().ContainSingle(c => c.Id == child.Id);
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

        found.Should().NotBeNull();
        var parentTodo = found!.Todos.First(t => t.Id == parent.Id);
        parentTodo.ChildTaskItems.Should().ContainSingle(c => c.Id == child.Id);
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

        found.Should().NotBeNull();
        var parentTodo = found!.Todos.First(t => t.Id == parent.Id);
        parentTodo.ChildTaskItems.Should().ContainSingle(c => c.Id == child.Id);
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
        rootItems.Should().ContainSingle(t => t.Id == parentId);

        // Assert 2: the parent has exactly one child with the expected Id.
        var parentTodo = todos.First(t => t.Id == parentId);
        parentTodo.ChildTaskItems.Should().ContainSingle(c => c.Id == childId);

        // Assert 3: the child's ParentTaskItemId is not null and correctly points to the parent.
        // This is the key assertion: without AsNoTracking this would be null due to identity map collision.
        var childItem = parentTodo.ChildTaskItems.First(c => c.Id == childId);
        childItem.ParentTaskItemId.Should().NotBeNull();
        childItem.ParentTaskItemId.Should().Be(parentId);
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
        childItem.CurrentJournalEntry.Should().NotBeNull();
        childItem.CurrentJournalEntry!.Id.Should().Be(secondEntry.Id);
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

        moved.Should().Equal(taskA.Id, taskB.Id);
        taskA.CurrentJournalEntryId.Should().Be(target.Id);
        taskA.MoveCount.Should().Be(1);
        taskA.FirstTaggedDate.Should().Be(a.Date);
        taskB.MoveCount.Should().Be(3);
        taskB.FirstTaggedDate.Should().Be(today.AddDays(-9));
        var events = context.TaskItemEvents.ToList();
        events.Should().HaveCount(2);
        events.Should().OnlyContain(e => e.EventType == "ReassignedToJournalDay"
            && e.ChangeSummary == "Automatically moved forward to the next journal day."
            && e.ToJournalEntryId == target.Id && e.ToJournalDate == today);
        events.Single(e => e.TaskItemId == taskA.Id).FromJournalEntryId.Should().Be(a.Id);
        events.Single(e => e.TaskItemId == taskA.Id).FromJournalDate.Should().Be(a.Date);
        events.Single(e => e.TaskItemId == taskB.Id).FromJournalEntryId.Should().Be(b.Id);
        events.Single(e => e.TaskItemId == taskB.Id).FromJournalDate.Should().Be(b.Date);
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

        moved.Should().Equal(openTask.Id);
        statusOnly.CurrentJournalEntryId.Should().Be(source.Id);
        flagOnly.CurrentJournalEntryId.Should().Be(source.Id);
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

        moved.Should().Equal(taskA.Id);
        taskA.CurrentJournalEntryId.Should().Be(target.Id);
        (await repo.GetTodosAsync(a.Id)).Should().BeEmpty();
        taskFuture.MoveCount.Should().Be(0);
        taskFuture.CurrentJournalEntryId.Should().NotBe(target.Id);
        orphan.CurrentJournalEntryId.Should().BeNull();
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

        moved.Should().Equal(old.Id);
        (await repo.GetTodosAsync(target.Id)).Select(t => t.Id).Should().BeEquivalentTo([existing.Id, old.Id]);
        existing.MoveCount.Should().Be(0);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldBeIdempotent_WhenRunTwice()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (_, task) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        (await repo.CarryForwardIncompleteTasksAsync(target.Id, today)).Should().Equal(task.Id);
        (await repo.CarryForwardIncompleteTasksAsync(target.Id, today)).Should().BeEmpty();

        task.MoveCount.Should().Be(1);
        context.TaskItemEvents.Should().HaveCount(1);
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

        (await repo.CarryForwardIncompleteTasksAsync(target.Id, today)).Should().BeEmpty();
        completedLater.CurrentJournalEntryId.Should().Be(target.Id);
        removedLater.CurrentJournalEntryId.Should().BeNull();
        completedLater.MoveCount.Should().Be(1);
        removedLater.MoveCount.Should().Be(1);
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

        openChild.CurrentJournalEntryId.Should().Be(target.Id);
        doneChild.CurrentJournalEntryId.Should().Be(source.Id);
        doneParent.CurrentJournalEntryId.Should().Be(source.Id);
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldReturnZero_WhenTargetIsNotUserToday()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (_, task) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        var tomorrow = await repo.AddAsync(new JournalEntry { Title = "Tomorrow", Date = today.AddDays(1) });

        (await repo.CarryForwardIncompleteTasksAsync(tomorrow.Id, today)).Should().BeEmpty();

        task.MoveCount.Should().Be(0);
        context.TaskItemEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldReturnZero_WhenEntryMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        (await repo.CarryForwardIncompleteTasksAsync(999, new DateOnly(2026, 10, 13))).Should().BeEmpty();
    }

    [Fact]
    public async Task CarryForwardIncompleteTasksAsync_ShouldReturnEmpty_WhenNoIncompleteEarlierTasks()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var today = new DateOnly(2026, 10, 13);
        var (source, _) = await SeedLinkedTaskAsync(context, today.AddDays(-1));
        await LinkNewTaskAsync(context, source, new TaskItem { Title = "Done", Status = Status.Completed, IsComplete = true });
        context.TaskItems.RemoveRange(context.TaskItems.Where(t => t.Status != Status.Completed));
        await context.SaveChangesAsync();
        var target = await repo.AddAsync(new JournalEntry { Title = "Today", Date = today });

        (await repo.CarryForwardIncompleteTasksAsync(target.Id, today)).Should().BeEmpty();
        context.TaskItemEvents.Should().BeEmpty();
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

        moved.Should().HaveCount(50);
        moved.Should().Equal(expectedOlder.Order().Concat(expectedNewer.Order()));
        context.TaskItemEvents.Count(e => e.EventType == "ReassignedToJournalDay").Should().Be(moved.Count);
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
            moved.Should().BeEmpty();
        }

        interceptor.Fired.Should().BeTrue();
        await using var verify = new TaskDbContext(seedOptions);
        var reloaded = await verify.TaskItems.SingleAsync(t => t.Id == taskId);
        reloaded.MoveCount.Should().Be(0);
        reloaded.CurrentJournalEntryId.Should().Be(sourceId);
        (await verify.TaskItemEvents.CountAsync()).Should().Be(0);
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
