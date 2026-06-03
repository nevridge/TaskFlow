using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/todos")]
public class JournalTodosController(
    IJournalEntryRepository journalRepo,
    IValidator<AddJournalTodoDto> validator) : ControllerBase
{
    private const string AssignmentPastDayErrorCode = "TASK_ASSIGNMENT_PAST_DAY_NOT_ALLOWED";
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
        var todoList = todos.ToList();

        var rootItems = todoList
            .Where(t => t.ParentTaskItemId is null)
            .Select(t => MapTodo(t, entry.Date));

        return Ok(rootItems);
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

        var result = await _journalRepo.AddTodoAsync(entryId, dto.TaskItemId, dto.TimezoneOffsetMinutes);
        return result switch
        {
            AddTodoResult.EntryNotFound => NotFound(),
            AddTodoResult.TaskNotFound => NotFound(),
            AddTodoResult.AlreadyLinked => Conflict(new { message = "This task is already linked to the journal entry." }),
            AddTodoResult.PastDayNotAllowed => UnprocessableEntity(new
            {
                code = AssignmentPastDayErrorCode,
                message = "This task cannot be assigned to a past day."
            }),
            _ => NoContent(),
        };
    }

    // DELETE: api/v1/JournalEntries/{entryId}/todos/{taskItemId}
    [HttpDelete("{taskItemId}")]
    public async Task<IActionResult> RemoveTodo(int entryId, int taskItemId)
    {
        var currentTodos = await _journalRepo.GetTodosAsync(entryId);
        var todoList = currentTodos.ToList();

        if (!await _journalRepo.RemoveTodoAsync(entryId, taskItemId))
        {
            return NotFound();
        }

        var children = todoList.Where(t => t.ParentTaskItemId == taskItemId);
        foreach (var child in children)
        {
            await _journalRepo.RemoveTodoAsync(entryId, child.Id);
        }

        return NoContent();
    }

    private static TaskItemResponseDto MapTodo(TaskItem task, DateOnly? entryDate)
    {
        var children = task.ChildTaskItems
            .Select(c => MapTodo(c, c.CurrentJournalEntry?.Date))
            .ToList();

        return new TaskItemResponseDto
        {
            Id = task.Id,
            Title = task.Title,
            Description = task.Description,
            IsComplete = task.IsComplete,
            DueDate = task.DueDate,
            Status = task.Status.ToString(),
            Priority = task.Priority.ToString(),
            ParentTaskItemId = task.ParentTaskItemId,
            CurrentJournalEntryId = task.CurrentJournalEntryId,
            FirstTaggedDate = task.FirstTaggedDate,
            MoveCount = task.MoveCount,
            CurrentJournalDate = entryDate,
            DaysTagged = GetDaysTagged(task.FirstTaggedDate, entryDate),
            Children = children.Count > 0 ? children : null,
        };
    }

    private static int GetDaysTagged(DateOnly? firstTaggedDate, DateOnly? currentJournalDate)
    {
        if (!firstTaggedDate.HasValue || !currentJournalDate.HasValue)
        {
            return 0;
        }

        return Math.Max(0, currentJournalDate.Value.DayNumber - firstTaggedDate.Value.DayNumber + 1);
    }
}
