using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class JournalEntryRepository(TaskDbContext context) : IJournalEntryRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<JournalEntry>> GetAllAsync() =>
        await _context.JournalEntries
            .Include(e => e.Todos)
            .Include(e => e.LogEntries)
            .ToListAsync();

    public async Task<JournalEntry?> GetByIdAsync(int id) =>
        await _context.JournalEntries
            .Include(e => e.Todos)
            .Include(e => e.LogEntries)
            .FirstOrDefaultAsync(e => e.Id == id);

    public async Task<JournalEntry> AddAsync(JournalEntry entry)
    {
        entry.CreatedAt = DateTime.UtcNow;
        _context.JournalEntries.Add(entry);
        await _context.SaveChangesAsync();
        return entry;
    }

    public async Task UpdateAsync(JournalEntry entry)
    {
        entry.UpdatedAt = DateTime.UtcNow;
        _context.JournalEntries.Update(entry);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var entry = await _context.JournalEntries.FindAsync(id);
        if (entry is null)
        {
            return;
        }

        _context.JournalEntries.Remove(entry);
        await _context.SaveChangesAsync();
    }

    public async Task<IEnumerable<TaskItem>> GetTodosAsync(int entryId)
    {
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        return entry?.Todos ?? [];
    }

    public async Task<TaskItem?> GetTodoAsync(int entryId, int taskItemId)
    {
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        return entry?.Todos.FirstOrDefault(t => t.Id == taskItemId);
    }

    public async Task AddTodoAsync(int entryId, int taskItemId)
    {
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        if (entry is null)
        {
            return;
        }

        var task = await _context.TaskItems.FindAsync(taskItemId);
        if (task is null)
        {
            return;
        }

        entry.Todos.Add(task);
        await _context.SaveChangesAsync();
    }

    public async Task RemoveTodoAsync(int entryId, int taskItemId)
    {
        var entry = await _context.JournalEntries
            .Include(e => e.Todos)
            .FirstOrDefaultAsync(e => e.Id == entryId);
        if (entry is null)
        {
            return;
        }

        var task = entry.Todos.FirstOrDefault(t => t.Id == taskItemId);
        if (task is null)
        {
            return;
        }

        entry.Todos.Remove(task);
        await _context.SaveChangesAsync();
    }
}
