using Asp.Versioning;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/todos")]
public class JournalTodosController(IJournalEntryService journalEntryService, ITaskService taskService) : ControllerBase
{
    private readonly IJournalEntryService _journalEntryService = journalEntryService;
    private readonly ITaskService _taskService = taskService;

    // GET: api/v1/JournalEntries/{entryId}/todos
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetAll(int entryId)
    {
        var entry = await _journalEntryService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var todos = await _journalEntryService.GetTodosAsync(entryId);
        return Ok(todos.Select(ToTaskItemDto));
    }

    // POST: api/v1/JournalEntries/{entryId}/todos
    [HttpPost]
    public async Task<IActionResult> Add(int entryId, [FromBody] AddJournalTodoDto addDto)
    {
        var entry = await _journalEntryService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var task = await _taskService.GetTaskAsync(addDto.TaskItemId);
        if (task is null)
        {
            return NotFound();
        }

        var existing = await _journalEntryService.GetTodoAsync(entryId, addDto.TaskItemId);
        if (existing is not null)
        {
            return Conflict();
        }

        await _journalEntryService.AddTodoAsync(entryId, addDto.TaskItemId);
        return NoContent();
    }

    // DELETE: api/v1/JournalEntries/{entryId}/todos/{taskItemId}
    [HttpDelete("{taskItemId}")]
    public async Task<IActionResult> Remove(int entryId, int taskItemId)
    {
        var entry = await _journalEntryService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var existing = await _journalEntryService.GetTodoAsync(entryId, taskItemId);
        if (existing is null)
        {
            return NotFound();
        }

        await _journalEntryService.RemoveTodoAsync(entryId, taskItemId);
        return NoContent();
    }

    private static TaskItemResponseDto ToTaskItemDto(TaskItem item) => new()
    {
        Id = item.Id,
        Title = item.Title,
        Description = item.Description,
        IsComplete = item.IsComplete,
        DueDate = item.DueDate,
        Status = item.Status.ToString(),
        Priority = item.Priority.ToString()
    };
}
