using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class JournalNoteRepositoryTests
{
    private static TaskDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    [Fact]
    public async Task GetAllByEntryIdAsync_ShouldReturnNotesOrderedByCreatedAt()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);
        await repo.AddAsync(new JournalNote { JournalEntryId = entry.Id, Content = "First" });
        await Task.Delay(5);
        await repo.AddAsync(new JournalNote { JournalEntryId = entry.Id, Content = "Second" });

        var notes = (await repo.GetAllByEntryIdAsync(entry.Id)).ToList();

        Assert.Equal(2, notes.Count);
        Assert.Equal("First", notes[0].Content);
        Assert.Equal("Second", notes[1].Content);
    }

    [Fact]
    public async Task GetAllByEntryIdAsync_ShouldNotReturnNotesFromOtherEntry()
    {
        using var context = CreateInMemoryContext();
        var entry1 = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        var entry2 = new JournalEntry { Title = "May 28", Date = new DateOnly(2026, 5, 28) };
        context.JournalEntries.AddRange(entry1, entry2);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);
        await repo.AddAsync(new JournalNote { JournalEntryId = entry1.Id, Content = "Entry1 note" });
        await repo.AddAsync(new JournalNote { JournalEntryId = entry2.Id, Content = "Entry2 note" });

        var notes = (await repo.GetAllByEntryIdAsync(entry1.Id)).ToList();

        Assert.Single(notes);
        Assert.Equal("Entry1 note", notes[0].Content);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNote_WhenExists()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);
        var note = await repo.AddAsync(new JournalNote { JournalEntryId = entry.Id, Content = "Test" });

        var fetched = await repo.GetByIdAsync(entry.Id, note.Id);

        Assert.NotNull(fetched);
        Assert.Equal("Test", fetched!.Content);
        Assert.Equal(entry.Id, fetched.JournalEntryId);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenNotFound()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);

        var result = await repo.GetByIdAsync(entry.Id, 9999);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenEntryIdMismatch()
    {
        using var context = CreateInMemoryContext();
        var entry1 = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        var entry2 = new JournalEntry { Title = "May 28", Date = new DateOnly(2026, 5, 28) };
        context.JournalEntries.AddRange(entry1, entry2);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);
        var note = await repo.AddAsync(new JournalNote { JournalEntryId = entry1.Id, Content = "Entry1 note" });

        var result = await repo.GetByIdAsync(entry2.Id, note.Id);

        Assert.Null(result);
    }

    [Fact]
    public async Task AddAsync_ShouldPersistNoteWithId()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);
        var note = await repo.AddAsync(new JournalNote { JournalEntryId = entry.Id, Content = "New note" });

        Assert.InRange(note.Id, 1, int.MaxValue);
        Assert.NotEqual(default, note.CreatedAt);
        Assert.Equal("New note", note.Content);
    }

    [Fact]
    public async Task UpdateAsync_ShouldSetUpdatedAt()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);
        var note = await repo.AddAsync(new JournalNote { JournalEntryId = entry.Id, Content = "Original" });

        note.Content = "Updated";
        await repo.UpdateAsync(note);

        var fetched = await repo.GetByIdAsync(entry.Id, note.Id);
        Assert.NotNull(fetched);
        Assert.Equal("Updated", fetched!.Content);
        Assert.NotNull(fetched.UpdatedAt);
    }

    [Fact]
    public async Task DeleteAsync_ShouldRemoveNote()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);
        var note = await repo.AddAsync(new JournalNote { JournalEntryId = entry.Id, Content = "To delete" });

        await repo.DeleteAsync(entry.Id, note.Id);

        var fetched = await repo.GetByIdAsync(entry.Id, note.Id);
        Assert.Null(fetched);
    }

    [Fact]
    public async Task DeleteAsync_ShouldNotThrow_WhenNoteNotFound()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 27", Date = new DateOnly(2026, 5, 27) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalNoteRepository(context);

        var act = async () => await repo.DeleteAsync(entry.Id, 9999);

        Assert.Null(await Record.ExceptionAsync(act));
    }
}
