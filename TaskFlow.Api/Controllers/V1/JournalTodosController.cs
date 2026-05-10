using Asp.Versioning;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/todos")]
public class JournalTodosController(IJournalEntryService journalService, ITaskService taskService) : ControllerBase
{
    private readonly IJournalEntryService _journalService = journalService;
    private readonly ITaskService _taskService = taskService;

    // GET: api/v1/JournalEntries/{entryId}/todos
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetAll(int entryId)
    {
        var entry = await _journalService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var todos = await _journalService.GetTodosAsync(entryId);
        return Ok(todos.Select(t => new TaskItemResponseDto
        {
            Id = t.Id,
            Title = t.Title,
            Description = t.Description,
            IsComplete = t.IsComplete,
            DueDate = t.DueDate,
            Status = t.Status.ToString(),
            Priority = t.Priority.ToString(),
        }));
    }

    // POST: api/v1/JournalEntries/{entryId}/todos
    [HttpPost]
    public async Task<IActionResult> AddTodo(int entryId, [FromBody] AddJournalTodoDto dto)
    {
        var entry = await _journalService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var task = await _taskService.GetTaskAsync(dto.TaskItemId);
        if (task is null)
        {
            return NotFound();
        }

        if (await _journalService.TodoExistsAsync(entryId, dto.TaskItemId))
        {
            return Conflict("This task is already linked to the journal entry.");
        }

        await _journalService.AddTodoAsync(entryId, dto.TaskItemId);
        return NoContent();
    }

    // DELETE: api/v1/JournalEntries/{entryId}/todos/{taskItemId}
    [HttpDelete("{taskItemId}")]
    public async Task<IActionResult> RemoveTodo(int entryId, int taskItemId)
    {
        var entry = await _journalService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        if (!await _journalService.TodoExistsAsync(entryId, taskItemId))
        {
            return NotFound();
        }

        await _journalService.RemoveTodoAsync(entryId, taskItemId);
        return NoContent();
    }
}
