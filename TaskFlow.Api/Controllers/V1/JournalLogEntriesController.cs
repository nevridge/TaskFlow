using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/logs")]
public class JournalLogEntriesController(
    IJournalLogEntryService logEntryService,
    IJournalEntryService journalEntryService,
    IValidator<JournalLogEntry> validator) : ControllerBase
{
    private const string GetLogEntryRouteName = "GetJournalLogEntryV1";
    private const string ApiVersionString = "1.0";
    private readonly IJournalLogEntryService _logEntryService = logEntryService;
    private readonly IJournalEntryService _journalEntryService = journalEntryService;
    private readonly IValidator<JournalLogEntry> _validator = validator;

    // GET: api/v1/JournalEntries/{entryId}/logs
    [HttpGet]
    public async Task<ActionResult<IEnumerable<JournalLogEntryResponseDto>>> GetAll(int entryId)
    {
        var entry = await _journalEntryService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var logs = await _logEntryService.GetAllByEntryIdAsync(entryId);
        return Ok(logs.Select(ToDto));
    }

    // GET: api/v1/JournalEntries/{entryId}/logs/{id}
    [HttpGet("{id}", Name = GetLogEntryRouteName)]
    public async Task<ActionResult<JournalLogEntryResponseDto>> Get(int entryId, int id)
    {
        var entry = await _journalEntryService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var logEntry = await _logEntryService.GetByIdAsync(entryId, id);
        if (logEntry is null)
        {
            return NotFound();
        }

        return Ok(ToDto(logEntry));
    }

    // POST: api/v1/JournalEntries/{entryId}/logs
    [HttpPost]
    public async Task<ActionResult<JournalLogEntryResponseDto>> Create(int entryId, [FromBody] CreateJournalLogEntryDto createDto)
    {
        var entry = await _journalEntryService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var logEntry = new JournalLogEntry { Content = createDto.Content, JournalEntryId = entryId };

        var validationResult = await _validator.ValidateAsync(logEntry);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var created = await _logEntryService.CreateAsync(logEntry);
        return CreatedAtRoute(GetLogEntryRouteName, new { version = ApiVersionString, entryId, id = created.Id }, ToDto(created));
    }

    // PUT: api/v1/JournalEntries/{entryId}/logs/{id}
    [HttpPut("{id}")]
    public async Task<ActionResult<JournalLogEntryResponseDto>> Update(int entryId, int id, [FromBody] UpdateJournalLogEntryDto updateDto)
    {
        var entry = await _journalEntryService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var existing = await _logEntryService.GetByIdAsync(entryId, id);
        if (existing is null)
        {
            return NotFound();
        }

        existing.Content = updateDto.Content;

        var validationResult = await _validator.ValidateAsync(existing);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        await _logEntryService.UpdateAsync(existing);
        return Ok(ToDto(existing));
    }

    // DELETE: api/v1/JournalEntries/{entryId}/logs/{id}
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int entryId, int id)
    {
        var entry = await _journalEntryService.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var existing = await _logEntryService.GetByIdAsync(entryId, id);
        if (existing is null)
        {
            return NotFound();
        }

        await _logEntryService.DeleteAsync(entryId, id);
        return NoContent();
    }

    private static JournalLogEntryResponseDto ToDto(JournalLogEntry logEntry) => new()
    {
        Id = logEntry.Id,
        Content = logEntry.Content,
        JournalEntryId = logEntry.JournalEntryId,
        CreatedAt = logEntry.CreatedAt,
        UpdatedAt = logEntry.UpdatedAt
    };
}
