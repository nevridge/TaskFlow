using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IJournalLogEntryRepository
{
    Task<IEnumerable<JournalLogEntry>> GetAllByEntryIdAsync(int entryId);
    Task<JournalLogEntry?> GetByIdAsync(int entryId, int logId);
    Task<JournalLogEntry> AddAsync(JournalLogEntry logEntry);
    Task UpdateAsync(JournalLogEntry logEntry);
    Task DeleteAsync(int entryId, int logId);
}
