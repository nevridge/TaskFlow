using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class TaskRepository(TaskDbContext context) : ITaskRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<TaskItem>> GetAllAsync() =>
        await _context.TaskItems.ToListAsync();

    public async Task<TaskItem?> GetByIdAsync(int id) =>
        await _context.TaskItems.FirstOrDefaultAsync(t => t.Id == id);

    public async Task<TaskItem> AddAsync(TaskItem task)
    {
        _context.TaskItems.Add(task);
        await _context.SaveChangesAsync();
        return task;
    }

    public async Task UpdateAsync(TaskItem task)
    {
        _context.TaskItems.Update(task);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var task = await _context.TaskItems.FindAsync(id);
        if (task is null)
        {
            return;
        }

        _context.TaskItems.Remove(task);
        await _context.SaveChangesAsync();
    }
}
