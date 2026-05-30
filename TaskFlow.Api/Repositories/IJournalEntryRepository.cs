using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IJournalEntryRepository
{
    Task<IEnumerable<JournalEntry>> GetAllAsync();
    Task<JournalEntry?> GetByIdAsync(int id);
    Task<JournalEntry?> GetByDateAsync(DateOnly date);
    Task<JournalEntry> AddAsync(JournalEntry entry);
    Task UpdateAsync(JournalEntry entry);
    Task DeleteAsync(int id);
    Task<IEnumerable<TaskItem>> GetTodosAsync(int entryId);
    Task<bool> TodoExistsAsync(int entryId, int taskItemId);
    Task<AddTodoResult> AddTodoAsync(int entryId, int taskItemId, int? timezoneOffsetMinutes = null);
    Task<bool> RemoveTodoAsync(int entryId, int taskItemId);
}
