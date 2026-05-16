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
    IValidator<JournalLogEntry> validator) : ControllerBase
{
    private const string GetLogRouteName = "GetJournalLogEntryV1";
    private const string ApiVersionString = "1.0";
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
    private readonly IJournalLogEntryRepository _logRepo = logRepo;
    private readonly IValidator<JournalLogEntry> _validator = validator;

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

        var log = new JournalLogEntry { Content = dto.Content, JournalEntryId = entryId };

        var validation = await _validator.ValidateAsync(log);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
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

        var validation = await _validator.ValidateAsync(existing);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
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
    };
}
