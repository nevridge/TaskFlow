using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Services;

public class JournalLogEntryService(IJournalLogEntryRepository repo) : IJournalLogEntryService
{
    private readonly IJournalLogEntryRepository _repo = repo;

    public async Task<IEnumerable<JournalLogEntry>> GetAllByEntryIdAsync(int entryId) => await _repo.GetAllByEntryIdAsync(entryId);
    public async Task<JournalLogEntry?> GetByIdAsync(int entryId, int logId) => await _repo.GetByIdAsync(entryId, logId);
    public async Task<JournalLogEntry> CreateAsync(JournalLogEntry logEntry) => await _repo.AddAsync(logEntry);
    public async Task UpdateAsync(JournalLogEntry logEntry) => await _repo.UpdateAsync(logEntry);
    public async Task DeleteAsync(int entryId, int logId) => await _repo.DeleteAsync(entryId, logId);
}
