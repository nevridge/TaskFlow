using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

public interface IJournalLogEntryService
{
    Task<IEnumerable<JournalLogEntry>> GetAllByEntryIdAsync(int entryId);
    Task<JournalLogEntry?> GetByIdAsync(int entryId, int logId);
    Task<JournalLogEntry> CreateAsync(JournalLogEntry logEntry);
    Task UpdateAsync(JournalLogEntry logEntry);
    Task DeleteAsync(int entryId, int logId);
}
