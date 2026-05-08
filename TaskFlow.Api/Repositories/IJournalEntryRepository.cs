using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IJournalEntryRepository
{
    Task<IEnumerable<JournalEntry>> GetAllAsync();
    Task<JournalEntry?> GetByIdAsync(int id);
    Task<JournalEntry> AddAsync(JournalEntry entry);
    Task UpdateAsync(JournalEntry entry);
    Task DeleteAsync(int id);
    Task<IEnumerable<TaskItem>> GetTodosAsync(int entryId);
    Task<TaskItem?> GetTodoAsync(int entryId, int taskItemId);
    Task AddTodoAsync(int entryId, int taskItemId);
    Task RemoveTodoAsync(int entryId, int taskItemId);
}
