using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class JournalNoteRepository(TaskDbContext context) : IJournalNoteRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<JournalNote>> GetAllByEntryIdAsync(int entryId) =>
        await _context.JournalNotes
            .AsNoTracking()
            .Where(n => n.JournalEntryId == entryId)
            .OrderBy(n => n.CreatedAt)
            .ToListAsync();

    public async Task<JournalNote?> GetByIdAsync(int entryId, int id) =>
        await _context.JournalNotes
            .FirstOrDefaultAsync(n => n.Id == id && n.JournalEntryId == entryId);

    public async Task<JournalNote?> GetByIdNoTrackingAsync(int entryId, int id) =>
        // Read-only query: AsNoTracking avoids change-tracking overhead; callers must not mutate or Update the result.
        await _context.JournalNotes
            .AsNoTracking()
            .FirstOrDefaultAsync(n => n.Id == id && n.JournalEntryId == entryId);

    public async Task<JournalNote> AddAsync(JournalNote note)
    {
        note.CreatedAt = DateTime.UtcNow;
        _context.JournalNotes.Add(note);
        await _context.SaveChangesAsync();
        return note;
    }

    public async Task UpdateAsync(JournalNote note)
    {
        note.UpdatedAt = DateTime.UtcNow;
        _context.JournalNotes.Update(note);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int entryId, int id)
    {
        var note = await _context.JournalNotes
            .FirstOrDefaultAsync(n => n.Id == id && n.JournalEntryId == entryId);
        if (note is null)
        {
            return;
        }

        _context.JournalNotes.Remove(note);
        await _context.SaveChangesAsync();
    }
}
