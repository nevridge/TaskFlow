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
    IValidator<AddJournalTodoDto> validator) : ControllerBase
{
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
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

        var result = await _journalRepo.AddTodoAsync(entryId, dto.TaskItemId);
        return result switch
        {
            AddTodoResult.EntryNotFound => NotFound(),
            AddTodoResult.TaskNotFound => NotFound(),
            AddTodoResult.AlreadyLinked => Conflict(new { message = "This task is already linked to the journal entry." }),
            _ => NoContent(),
        };
    }

    // DELETE: api/v1/JournalEntries/{entryId}/todos/{taskItemId}
    [HttpDelete("{taskItemId}")]
    public async Task<IActionResult> RemoveTodo(int entryId, int taskItemId)
    {
        if (!await _journalRepo.RemoveTodoAsync(entryId, taskItemId))
        {
            return NotFound();
        }
        return NoContent();
    }
}
