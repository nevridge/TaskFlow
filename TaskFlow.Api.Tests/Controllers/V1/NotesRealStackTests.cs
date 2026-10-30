using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Real-stack Delete tests for <see cref="NotesController"/> and <see cref="JournalNotesController"/>: the controller's
/// untracked lookup is followed by the repository's own tracked re-fetch, on a fresh context per simulated request.
/// </summary>
public sealed class NotesRealStackTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly DbContextOptions<TaskDbContext> _options;

    public NotesRealStackTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _options = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options;
        using var ctx = new TaskDbContext(_options);
        ctx.Database.EnsureCreated();
    }

    public void Dispose() => _connection.Dispose();

    private TaskDbContext NewContext() => new(_options);

    [Fact]
    public async Task NotesDelete_AfterNoTrackingLookup_RemovesRow()
    {
        int taskId, noteId;
        await using (var seed = NewContext())
        {
            var task = new TaskItem { Title = "T" };
            var note = new Note { Content = "n", TaskItem = task };
            seed.Notes.Add(note);
            await seed.SaveChangesAsync();
            taskId = task.Id;
            noteId = note.Id;
        }

        await using (var ctx = NewContext())
        {
            var controller = new NotesController(
                new NoteRepository(ctx), new TaskRepository(ctx), new Mock<IValidator<Note>>().Object);
            var result = await controller.Delete(taskId, noteId);
            Assert.IsType<NoContentResult>(result);
        }

        await using var verify = NewContext();
        Assert.False(await verify.Notes.AnyAsync(n => n.Id == noteId));
    }

    [Fact]
    public async Task JournalNotesDelete_AfterNoTrackingLookup_RemovesRow()
    {
        int entryId, noteId;
        await using (var seed = NewContext())
        {
            var entry = new JournalEntry { Title = "Day", Date = new DateOnly(2026, 5, 1) };
            var note = new JournalNote { Content = "n", JournalEntry = entry };
            seed.JournalNotes.Add(note);
            await seed.SaveChangesAsync();
            entryId = entry.Id;
            noteId = note.Id;
        }

        await using (var ctx = NewContext())
        {
            var controller = new JournalNotesController(
                new JournalEntryRepository(ctx), new JournalNoteRepository(ctx), new Mock<IValidator<JournalNote>>().Object);
            var result = await controller.Delete(entryId, noteId);
            Assert.IsType<NoContentResult>(result);
        }

        await using var verify = NewContext();
        Assert.False(await verify.JournalNotes.AnyAsync(n => n.Id == noteId));
    }
}
