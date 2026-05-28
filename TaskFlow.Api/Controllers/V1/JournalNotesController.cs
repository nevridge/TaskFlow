using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/notes")]
public class JournalNotesController(
    IJournalEntryRepository journalRepo,
    IJournalNoteRepository noteRepo,
    IValidator<JournalNote> validator) : ControllerBase
{
    private const string GetNoteRouteName = "GetJournalNoteV1";
    private const string ApiVersionString = "1.0";
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
    private readonly IJournalNoteRepository _noteRepo = noteRepo;
    private readonly IValidator<JournalNote> _validator = validator;

    // GET: api/v1/JournalEntries/{entryId}/notes
    [HttpGet]
    public async Task<ActionResult<IEnumerable<JournalNoteResponseDto>>> GetAll(int entryId)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var notes = await _noteRepo.GetAllByEntryIdAsync(entryId);
        return Ok(notes.Select(ToDto));
    }

    // GET: api/v1/JournalEntries/{entryId}/notes/{id}
    [HttpGet("{id}", Name = GetNoteRouteName)]
    public async Task<ActionResult<JournalNoteResponseDto>> Get(int entryId, int id)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var note = await _noteRepo.GetByIdAsync(entryId, id);
        if (note is null)
        {
            return NotFound();
        }

        return Ok(ToDto(note));
    }

    // POST: api/v1/JournalEntries/{entryId}/notes
    [HttpPost]
    public async Task<ActionResult<JournalNoteResponseDto>> Create(int entryId, [FromBody] CreateJournalNoteDto dto)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var note = new JournalNote { Content = dto.Content, JournalEntryId = entryId };

        var validation = await _validator.ValidateAsync(note);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
        }

        var created = await _noteRepo.AddAsync(note);
        return CreatedAtRoute(GetNoteRouteName, new { version = ApiVersionString, entryId, id = created.Id }, ToDto(created));
    }

    // PUT: api/v1/JournalEntries/{entryId}/notes/{id}
    [HttpPut("{id}")]
    public async Task<ActionResult<JournalNoteResponseDto>> Update(int entryId, int id, [FromBody] UpdateJournalNoteDto dto)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var existing = await _noteRepo.GetByIdAsync(entryId, id);
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

        await _noteRepo.UpdateAsync(existing);
        return Ok(ToDto(existing));
    }

    // DELETE: api/v1/JournalEntries/{entryId}/notes/{id}
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int entryId, int id)
    {
        var entry = await _journalRepo.GetByIdAsync(entryId);
        if (entry is null)
        {
            return NotFound();
        }

        var existing = await _noteRepo.GetByIdAsync(entryId, id);
        if (existing is null)
        {
            return NotFound();
        }

        await _noteRepo.DeleteAsync(entryId, id);
        return NoContent();
    }

    private static JournalNoteResponseDto ToDto(JournalNote n) => new()
    {
        Id = n.Id,
        Content = n.Content,
        JournalEntryId = n.JournalEntryId,
        CreatedAt = n.CreatedAt,
        UpdatedAt = n.UpdatedAt,
    };
}
