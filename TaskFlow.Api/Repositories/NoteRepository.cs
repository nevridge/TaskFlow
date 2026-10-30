using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class NoteRepository(TaskDbContext context) : INoteRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<Note>> GetAllByTaskIdAsync(int taskId) =>
        await _context.Notes.AsNoTracking().Where(n => n.TaskItemId == taskId).ToListAsync();

    public async Task<Note?> GetByIdAsync(int taskId, int noteId) =>
        await _context.Notes.FirstOrDefaultAsync(n => n.Id == noteId && n.TaskItemId == taskId);

    public async Task<Note?> GetByIdNoTrackingAsync(int taskId, int noteId) =>
        // Read-only query: AsNoTracking avoids change-tracking overhead; callers must not mutate or Update the result.
        await _context.Notes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == noteId && n.TaskItemId == taskId);

    public async Task<Note> AddAsync(Note note)
    {
        note.CreatedAt = DateTime.UtcNow;
        _context.Notes.Add(note);
        await _context.SaveChangesAsync();
        return note;
    }

    public async Task UpdateAsync(Note note)
    {
        note.UpdatedAt = DateTime.UtcNow;
        _context.Notes.Update(note);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int taskId, int noteId)
    {
        var note = await _context.Notes.FirstOrDefaultAsync(n => n.Id == noteId && n.TaskItemId == taskId);
        if (note is null)
        {
            return;
        }

        _context.Notes.Remove(note);
        await _context.SaveChangesAsync();
    }
}
