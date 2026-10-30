using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface ITaskRepository
{
    Task<IEnumerable<TaskItem>> GetAllAsync();
    Task<TaskItem?> GetByIdAsync(int id);
    Task<IEnumerable<TaskItem>> GetChildrenAsync(int parentId);
    Task<DateOnly?> GetAssignedJournalDateAsync(int taskId);
    Task<IReadOnlyDictionary<int, DateOnly>> GetAssignedJournalDatesAsync(IReadOnlyCollection<int> taskIds);
    Task<IReadOnlyDictionary<int, DateOnly>> GetLastMovedDatesAsync(IReadOnlyCollection<int> taskIds);
    Task<IEnumerable<TaskItemEvent>> GetHistoryAsync(int taskId);
    Task<TaskItem> AddAsync(TaskItem task);
    Task UpdateAsync(TaskItem task);
    Task DeleteAsync(int id);
}
