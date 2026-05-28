using FluentAssertions;
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

        notes.Should().HaveCount(2);
        notes[0].Content.Should().Be("First");
        notes[1].Content.Should().Be("Second");
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

        notes.Should().HaveCount(1);
        notes[0].Content.Should().Be("Entry1 note");
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

        fetched.Should().NotBeNull();
        fetched!.Content.Should().Be("Test");
        fetched.JournalEntryId.Should().Be(entry.Id);
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

        result.Should().BeNull();
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

        result.Should().BeNull();
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

        note.Id.Should().BeGreaterThan(0);
        note.CreatedAt.Should().NotBe(default);
        note.Content.Should().Be("New note");
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
        fetched.Should().NotBeNull();
        fetched!.Content.Should().Be("Updated");
        fetched.UpdatedAt.Should().NotBeNull();
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
        fetched.Should().BeNull();
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

        await act.Should().NotThrowAsync();
    }
}
