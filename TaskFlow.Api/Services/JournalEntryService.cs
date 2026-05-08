using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Services;

public class JournalEntryService(IJournalEntryRepository repo) : IJournalEntryService
{
    private readonly IJournalEntryRepository _repo = repo;

    public async Task<IEnumerable<JournalEntry>> GetAllAsync() =>
        await _repo.GetAllAsync();

    public async Task<JournalEntry?> GetByIdAsync(int id) =>
        await _repo.GetByIdAsync(id);

    public async Task<JournalEntry> CreateAsync(JournalEntry entry) =>
        await _repo.AddAsync(entry);

    public async Task UpdateAsync(JournalEntry entry) =>
        await _repo.UpdateAsync(entry);

    public async Task DeleteAsync(int id) =>
        await _repo.DeleteAsync(id);

    public async Task<IEnumerable<TaskItem>> GetTodosAsync(int entryId) =>
        await _repo.GetTodosAsync(entryId);

    public async Task<TaskItem?> GetTodoAsync(int entryId, int taskItemId) =>
        await _repo.GetTodoAsync(entryId, taskItemId);

    public async Task AddTodoAsync(int entryId, int taskItemId) =>
        await _repo.AddTodoAsync(entryId, taskItemId);

    public async Task RemoveTodoAsync(int entryId, int taskItemId) =>
        await _repo.RemoveTodoAsync(entryId, taskItemId);
}
