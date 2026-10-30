using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface INoteRepository
{
    Task<IEnumerable<Note>> GetAllByTaskIdAsync(int taskId);
    Task<Note?> GetByIdAsync(int taskId, int noteId);
    Task<Note?> GetByIdNoTrackingAsync(int taskId, int noteId);
    Task<Note> AddAsync(Note note);
    Task UpdateAsync(Note note);
    Task DeleteAsync(int taskId, int noteId);
}
