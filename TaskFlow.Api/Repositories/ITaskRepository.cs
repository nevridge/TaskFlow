using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface ITaskRepository
{
    Task<IEnumerable<TaskItem>> GetAllAsync();
    Task<TaskItem?> GetByIdAsync(int id);
    Task<TaskItem?> GetByIdNoTrackingAsync(int id);
    Task<IEnumerable<TaskItem>> GetChildrenAsync(int parentId);
    Task<DateOnly?> GetAssignedJournalDateAsync(int taskId);
    Task<IReadOnlyDictionary<int, DateOnly>> GetAssignedJournalDatesAsync(IReadOnlyCollection<int> taskIds);
    Task<IReadOnlyDictionary<int, DateOnly>> GetLastMovedDatesAsync(IReadOnlyCollection<int> taskIds);
    Task<IEnumerable<TaskItemEvent>> GetHistoryAsync(int taskId);
    Task<TaskItem> AddAsync(TaskItem task);
    Task UpdateAsync(TaskItem task);
    Task DeleteAsync(int id);

    /// <summary>
    /// Starts a database transaction on the shared scoped context. Every save made through any repository
    /// on that context until commit is rolled back if the returned transaction is disposed uncommitted.
    /// </summary>
    Task<IRepositoryTransaction> BeginTransactionAsync();
}
