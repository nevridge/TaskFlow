using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/logs")]
public class JournalLogEntriesController(
    IJournalEntryRepository journalRepo,
    IJournalLogEntryRepository logRepo,
    IValidator<JournalLogEntry> validator,
    ITaskRepository taskRepo) : ControllerBase
{
    private const string GetLogRouteName = "GetJournalLogEntryV1";
    private const string ApiVersionString = "1.0";
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
    private readonly IJournalLogEntryRepository _logRepo = logRepo;
    private readonly IValidator<JournalLogEntry> _validator = validator;
    private readonly ITaskRepository _taskRepo = taskRepo;

    // GET: api/v1/JournalEntries/{entryId}/logs
    [HttpGet]
    public async Task<ActionResult<IEnumerable<JournalLogEntryResponseDto>>> GetAll(int entryId)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var logs = await _logRepo.GetAllByEntryIdAsync(entryId);
        return Ok(logs.Select(ToDto));
    }

    // GET: api/v1/JournalEntries/{entryId}/logs/{id}
    [HttpGet("{id}", Name = GetLogRouteName)]
    public async Task<ActionResult<JournalLogEntryResponseDto>> Get(int entryId, int id)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var log = await _logRepo.GetByIdAsync(entryId, id);
        if (log is null)
        {
            return NotFound();
        }

        return Ok(ToDto(log));
    }

    // POST: api/v1/JournalEntries/{entryId}/logs
    [HttpPost]
    public async Task<ActionResult<JournalLogEntryResponseDto>> Create(int entryId, [FromBody] CreateJournalLogEntryDto dto)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var log = new JournalLogEntry { Content = dto.Content, JournalEntryId = entryId, TaskItemId = dto.TaskItemId };

        var validation = await _validator.ValidateAsync(log);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
        }

        if (dto.TaskItemId.HasValue)
        {
            var task = await _taskRepo.GetByIdAsync(dto.TaskItemId.Value);
            if (task is null)
            {
                return BadRequest($"TaskItem with id {dto.TaskItemId.Value} was not found.");
            }

            log.TaskItemId = task.Id;
            log.LinkedTaskTitleSnapshot = task.Title;
        }

        var created = await _logRepo.AddAsync(log);
        return CreatedAtRoute(GetLogRouteName, new { version = ApiVersionString, entryId, id = created.Id }, ToDto(created));
    }

    // PUT: api/v1/JournalEntries/{entryId}/logs/{id}
    [HttpPut("{id}")]
    public async Task<ActionResult<JournalLogEntryResponseDto>> Update(int entryId, int id, [FromBody] UpdateJournalLogEntryDto dto)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var existing = await _logRepo.GetByIdAsync(entryId, id);
        if (existing is null)
        {
            return NotFound();
        }

        existing.Content = dto.Content;
        existing.TaskItemId = dto.TaskItemId;

        var validation = await _validator.ValidateAsync(existing);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
        }

        if (dto.TaskItemId.HasValue)
        {
            var task = await _taskRepo.GetByIdAsync(dto.TaskItemId.Value);
            if (task is null)
            {
                return BadRequest($"TaskItem with id {dto.TaskItemId.Value} was not found.");
            }

            existing.TaskItemId = task.Id;
            existing.LinkedTaskTitleSnapshot = task.Title;
        }
        else
        {
            existing.TaskItemId = null;
            existing.LinkedTaskTitleSnapshot = null;
        }

        await _logRepo.UpdateAsync(existing);
        return Ok(ToDto(existing));
    }

    // DELETE: api/v1/JournalEntries/{entryId}/logs/{id}
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int entryId, int id)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var existing = await _logRepo.GetByIdAsync(entryId, id);
        if (existing is null)
        {
            return NotFound();
        }

        await _logRepo.DeleteAsync(entryId, id);
        return NoContent();
    }

    private static JournalLogEntryResponseDto ToDto(JournalLogEntry l) => new()
    {
        Id = l.Id,
        Content = l.Content,
        JournalEntryId = l.JournalEntryId,
        CreatedAt = l.CreatedAt,
        UpdatedAt = l.UpdatedAt,
        TaskItemId = l.TaskItemId,
        LinkedTaskTitle = l.TaskItem?.Title ?? l.LinkedTaskTitleSnapshot,
        LinkedTaskDeleted = l.TaskItemId is null && l.LinkedTaskTitleSnapshot is not null,
    };
}
