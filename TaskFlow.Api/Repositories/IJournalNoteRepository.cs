using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IJournalNoteRepository
{
    Task<IEnumerable<JournalNote>> GetAllByEntryIdAsync(int entryId);
    Task<JournalNote?> GetByIdAsync(int entryId, int id);
    Task<JournalNote> AddAsync(JournalNote note);
    Task UpdateAsync(JournalNote note);
    Task DeleteAsync(int entryId, int id);
}
