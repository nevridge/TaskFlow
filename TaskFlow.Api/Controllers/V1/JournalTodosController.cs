using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion(ApiVersions.V1)]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/todos")]
public class JournalTodosController(
    IJournalEntryRepository journalRepo,
    IValidator<AddJournalTodoDto> validator,
    IValidator<JournalDayQueryDto> queryValidator) : ControllerBase
{
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
    private readonly IValidator<AddJournalTodoDto> _validator = validator;
    private readonly IValidator<JournalDayQueryDto> _queryValidator = queryValidator;

    /// <summary>
    /// The todos of a journal day. A completed task with a completion time is a todo on the local day it was
    /// completed (derived with <c>timezoneOffsetMinutes</c>, UTC when omitted), not on its linked day; every other
    /// task is a todo on its linked day. Each task is a todo row on exactly one day.
    /// </summary>
    /// <remarks>
    /// Returns one flat row per task attributed to the day (roots and subtasks alike), ordered by id; rows carry no
    /// <c>children</c>. A subtask row carries <c>parentTaskItemId</c> and <c>parentTitle</c> even when its parent is
    /// not a row of this day (no parent row is synthesised). <c>childTaskCount</c> is the task's total subtasks and
    /// <c>openChildCount</c> the subtasks that are not Completed (Blocked counts as open). Each row's
    /// <c>currentJournalDate</c> is the task's own linked day (null when it was never linked).
    /// </remarks>
    // GET: api/v1/JournalEntries/{entryId}/todos
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetAll(int entryId, [FromQuery] JournalDayQueryDto query)
    {
        var queryValidation = await _queryValidator.ValidateAsync(query);
        if (!queryValidation.IsValid)
        {
            return BadRequest(queryValidation.Errors);
        }

        var day = await _journalRepo.GetTodosForDayAsync(entryId, query.TimezoneOffsetMinutes);
        if (day is null)
        {
            return NotFound();
        }

        return Ok(day.Tasks.OrderBy(t => t.Id).Select(MapTodo).ToList());
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
        if (result == AddTodoResult.TaskCompleted)
        {
            var details = await _journalRepo.GetPlanCompletedDetailsAsync(entryId, dto.TaskItemId);
            return UnprocessableEntity(TaskRuleErrors.PlanCompletedNotAllowed(
                details?.AssignedDate, details?.CompletedAt, details?.JournalDate));
        }

        return result switch
        {
            AddTodoResult.Success => NoContent(),
            AddTodoResult.EntryNotFound => NotFound(),
            AddTodoResult.TaskNotFound => NotFound(),
            // The day is not echoed: the request names the entry, not a date.
            AddTodoResult.HasOpenSubtasks => UnprocessableEntity(TaskRuleErrors.PlanHasOpenSubtasks(dto.TaskItemId, null)),
            AddTodoResult.AlreadyLinked => Conflict(new { message = "This task is already linked to the journal entry." }),
            AddTodoResult.PastDayNotAllowed => UnprocessableEntity(new
            {
                code = ErrorCodes.AssignmentPastDayNotAllowed,
                message = "This task cannot be assigned to a past day."
            }),
            _ => throw new InvalidOperationException(
                $"Adding task {dto.TaskItemId} to journal entry {entryId} failed unexpectedly: {result}.")
        };
    }

    // DELETE: api/v1/JournalEntries/{entryId}/todos/{taskItemId}
    [HttpDelete("{taskItemId}")]
    public async Task<IActionResult> RemoveTodo(int entryId, int taskItemId)
    {
        // Unlinks only the removed task; its subtasks are separate rows with their own links.
        return await _journalRepo.RemoveTodoAsync(entryId, taskItemId) ? NoContent() : NotFound();
    }

    // One flat row per task. ChildTaskCount is the total subtasks, OpenChildCount those not Completed; Children is
    // never populated here (the client groups by ParentTaskItemId).
    private static TaskItemResponseDto MapTodo(TaskItem task)
    {
        // The task's own linked day, not the viewed day: a completed task is a row on its completion day.
        var linkedDate = task.CurrentJournalEntry?.Date;

        return new TaskItemResponseDto
        {
            Id = task.Id,
            Title = task.Title,
            Description = task.Description,
            DueDate = task.DueDate,
            Status = task.Status.ToString(),
            Priority = task.Priority.ToString(),
            ParentTaskItemId = task.ParentTaskItemId,
            ProjectId = task.ProjectId,
            ProjectName = task.Project?.Name,
            CurrentJournalEntryId = task.CurrentJournalEntryId,
            FirstTaggedDate = task.FirstTaggedDate,
            MoveCount = task.MoveCount,
            CurrentJournalDate = linkedDate,
            DaysTagged = DaysTaggedHelper.GetDaysTagged(task.FirstTaggedDate, linkedDate),
            ChildTaskCount = task.ChildTaskItems.Count,
            ParentTitle = task.ParentTaskItem?.Title,
            OpenChildCount = task.ChildTaskItems.Count(c => c.Status != Status.Completed),
            BlockedReason = task.BlockedReason,
            BlockedAt = task.BlockedAt,
            PreviousStatus = task.PreviousStatus?.ToString(),
            StartedAt = task.StartedAt,
            CompletedAt = task.CompletedAt,
        };
    }
}
