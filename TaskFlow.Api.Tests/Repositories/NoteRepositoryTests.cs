using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class NoteRepositoryTests
{
    private static TaskDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    private static TaskItem SeedTask(TaskDbContext context, int id = 1)
    {
        var task = new TaskItem { Id = id, Title = $"Task {id}" };
        context.TaskItems.Add(task);
        context.SaveChanges();
        return task;
    }

    [Fact]
    public async Task GetAllByTaskIdAsync_ShouldReturnNotesForTask()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        SeedTask(context, 2);
        context.Notes.AddRange(
            new Note { Content = "Note A", TaskItemId = 1 },
            new Note { Content = "Note B", TaskItemId = 1 },
            new Note { Content = "Note C", TaskItemId = 2 }
        );
        await context.SaveChangesAsync();
        var repo = new NoteRepository(context);

        var result = await repo.GetAllByTaskIdAsync(1);

        Assert.Equal(2, result.Count());
        Assert.All(result, n => Assert.Equal(1, n.TaskItemId));
    }

    [Fact]
    public async Task GetAllByTaskIdAsync_ShouldReturnEmpty_WhenTaskHasNoNotes()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        var repo = new NoteRepository(context);

        var result = await repo.GetAllByTaskIdAsync(1);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNote_WhenNoteExistsForTask()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        var note = new Note { Content = "Test note", TaskItemId = 1 };
        context.Notes.Add(note);
        await context.SaveChangesAsync();
        var repo = new NoteRepository(context);

        var result = await repo.GetByIdAsync(1, note.Id);

        Assert.NotNull(result);
        Assert.Equal("Test note", result!.Content);
        Assert.Equal(1, result.TaskItemId);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenNoteDoesNotBelongToTask()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        SeedTask(context, 2);
        var note = new Note { Content = "Task 2 note", TaskItemId = 2 };
        context.Notes.Add(note);
        await context.SaveChangesAsync();
        var repo = new NoteRepository(context);

        var result = await repo.GetByIdAsync(1, note.Id);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenNoteDoesNotExist()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        var repo = new NoteRepository(context);

        var result = await repo.GetByIdAsync(1, 999);

        Assert.Null(result);
    }

    [Fact]
    public async Task AddAsync_ShouldAddNoteAndReturnIt()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        var repo = new NoteRepository(context);
        var note = new Note { Content = "New note", TaskItemId = 1 };

        var result = await repo.AddAsync(note);

        Assert.InRange(result.Id, 1, int.MaxValue);
        Assert.Equal("New note", result.Content);
        Assert.Equal(1, result.TaskItemId);
        Assert.Equal(DateTime.UtcNow, result.CreatedAt, TimeSpan.FromSeconds(5));

        var saved = await context.Notes.FindAsync(result.Id);
        Assert.NotNull(saved);
    }

    [Fact]
    public async Task UpdateAsync_ShouldUpdateNoteContent()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        var note = new Note { Content = "Original", TaskItemId = 1 };
        context.Notes.Add(note);
        await context.SaveChangesAsync();
        var repo = new NoteRepository(context);

        note.Content = "Updated";
        await repo.UpdateAsync(note);

        var updated = await context.Notes.FindAsync(note.Id);
        Assert.Equal("Updated", updated!.Content);
        Assert.NotNull(updated.UpdatedAt);
        Assert.Equal(DateTime.UtcNow, updated.UpdatedAt.Value, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task DeleteAsync_ShouldRemoveNote_WhenNoteExists()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        var note = new Note { Content = "To delete", TaskItemId = 1 };
        context.Notes.Add(note);
        await context.SaveChangesAsync();
        var repo = new NoteRepository(context);

        await repo.DeleteAsync(1, note.Id);

        var deleted = await context.Notes.FindAsync(note.Id);
        Assert.Null(deleted);
    }

    [Fact]
    public async Task DeleteAsync_ShouldNotThrow_WhenNoteDoesNotExist()
    {
        using var context = CreateInMemoryContext();
        var repo = new NoteRepository(context);

        var act = async () => await repo.DeleteAsync(1, 999);

        Assert.Null(await Record.ExceptionAsync(act));
    }

    [Fact]
    public async Task DeleteAsync_ShouldNotDeleteNote_WhenNoteDoesNotBelongToTask()
    {
        using var context = CreateInMemoryContext();
        SeedTask(context, 1);
        SeedTask(context, 2);
        var note = new Note { Content = "Task 2 note", TaskItemId = 2 };
        context.Notes.Add(note);
        await context.SaveChangesAsync();
        var repo = new NoteRepository(context);

        await repo.DeleteAsync(1, note.Id);

        var stillExists = await context.Notes.FindAsync(note.Id);
        Assert.NotNull(stillExists);
    }

    [Fact]
    public async Task DeleteTaskAsync_ShouldCascadeDeleteNotes()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseSqlite(connection)
            .Options;

        await using (var context = new TaskDbContext(options))
        {
            await context.Database.EnsureCreatedAsync();
            var task = new TaskItem { Title = "Task with notes" };
            context.TaskItems.Add(task);
            await context.SaveChangesAsync();
            context.Notes.AddRange(
                new Note { Content = "Note 1", TaskItemId = task.Id },
                new Note { Content = "Note 2", TaskItemId = task.Id }
            );
            await context.SaveChangesAsync();

            context.TaskItems.Remove(task);
            await context.SaveChangesAsync();
        }

        await using (var context = new TaskDbContext(options))
        {
            var remainingNotes = await context.Notes.ToListAsync();
            Assert.Empty(remainingNotes);
        }

        connection.Close();
    }
}
