using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class JournalLogEntryRepository(TaskDbContext context) : IJournalLogEntryRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<JournalLogEntry>> GetAllByEntryIdAsync(int entryId) =>
        await _context.JournalLogEntries
            .Where(l => l.JournalEntryId == entryId)
            .OrderBy(l => l.CreatedAt)
            .ToListAsync();

    public async Task<JournalLogEntry?> GetByIdAsync(int entryId, int logId) =>
        await _context.JournalLogEntries
            .FirstOrDefaultAsync(l => l.Id == logId && l.JournalEntryId == entryId);

    public async Task<JournalLogEntry> AddAsync(JournalLogEntry logEntry)
    {
        logEntry.CreatedAt = DateTime.UtcNow;
        _context.JournalLogEntries.Add(logEntry);
        await _context.SaveChangesAsync();
        return logEntry;
    }

    public async Task UpdateAsync(JournalLogEntry logEntry)
    {
        logEntry.UpdatedAt = DateTime.UtcNow;
        _context.JournalLogEntries.Update(logEntry);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int entryId, int logId)
    {
        var log = await _context.JournalLogEntries
            .FirstOrDefaultAsync(l => l.Id == logId && l.JournalEntryId == entryId);
        if (log is null)
        {
            return;
        }

        _context.JournalLogEntries.Remove(log);
        await _context.SaveChangesAsync();
    }
}
