using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/todos")]
public class JournalTodosController(
    IJournalEntryRepository journalRepo,
    ITaskRepository taskRepo,
    IValidator<AddJournalTodoDto> validator) : ControllerBase
{
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
    private readonly ITaskRepository _taskRepo = taskRepo;
    private readonly IValidator<AddJournalTodoDto> _validator = validator;

    // GET: api/v1/JournalEntries/{entryId}/todos
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetAll(int entryId)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var todos = await _journalRepo.GetTodosAsync(entryId);
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
        var validationResult = await _validator.ValidateAsync(dto);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var task = await _taskRepo.GetByIdAsync(dto.TaskItemId);
        if (task is null)
        {
            return NotFound();
        }

        if (await _journalRepo.TodoExistsAsync(entryId, dto.TaskItemId))
        {
            return Conflict(new { message = "This task is already linked to the journal entry." });
        }

        if (!await _journalRepo.AddTodoAsync(entryId, dto.TaskItemId))
        {
            return NotFound();
        }
        return NoContent();
    }

    // DELETE: api/v1/JournalEntries/{entryId}/todos/{taskItemId}
    [HttpDelete("{taskItemId}")]
    public async Task<IActionResult> RemoveTodo(int entryId, int taskItemId)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        if (!await _journalRepo.TodoExistsAsync(entryId, taskItemId))
        {
            return NotFound();
        }

        if (!await _journalRepo.RemoveTodoAsync(entryId, taskItemId))
        {
            return NotFound();
        }
        return NoContent();
    }
}
