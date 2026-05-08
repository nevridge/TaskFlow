using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
public class JournalEntriesController(IJournalEntryService journalEntryService, IValidator<JournalEntry> validator) : ControllerBase
{
    private const string GetJournalEntryRouteName = "GetJournalEntryV1";
    private const string ApiVersionString = "1.0";
    private readonly IJournalEntryService _journalEntryService = journalEntryService;
    private readonly IValidator<JournalEntry> _validator = validator;

    // GET: api/v1/JournalEntries
    [HttpGet]
    public async Task<ActionResult<IEnumerable<JournalEntryResponseDto>>> GetAll()
    {
        var entries = await _journalEntryService.GetAllAsync();
        return Ok(entries.Select(ToDto));
    }

    // GET: api/v1/JournalEntries/5
    [HttpGet("{id}", Name = GetJournalEntryRouteName)]
    public async Task<ActionResult<JournalEntryResponseDto>> Get(int id)
    {
        var entry = await _journalEntryService.GetByIdAsync(id);
        if (entry is null)
        {
            return NotFound();
        }

        return Ok(ToDto(entry));
    }

    // POST: api/v1/JournalEntries
    [HttpPost]
    public async Task<ActionResult<JournalEntryResponseDto>> Create([FromBody] CreateJournalEntryDto createDto)
    {
        var entry = new JournalEntry
        {
            Title = createDto.Title,
            Summary = createDto.Summary,
            Date = createDto.Date
        };

        var validationResult = await _validator.ValidateAsync(entry);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var existing = await _journalEntryService.GetByDateAsync(entry.Date);
        if (existing is not null)
        {
            return Conflict(new ProblemDetails
            {
                Title = "Journal entry already exists",
                Detail = $"A journal entry already exists for {entry.Date:yyyy-MM-dd}.",
                Status = StatusCodes.Status409Conflict
            });
        }

        var created = await _journalEntryService.CreateAsync(entry);
        return CreatedAtRoute(GetJournalEntryRouteName, new { version = ApiVersionString, id = created.Id }, ToDto(created));
    }

    // PUT: api/v1/JournalEntries/5
    [HttpPut("{id}")]
    public async Task<ActionResult<JournalEntryResponseDto>> Update(int id, [FromBody] UpdateJournalEntryDto updateDto)
    {
        var existing = await _journalEntryService.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        existing.Title = updateDto.Title;
        existing.Summary = updateDto.Summary;

        var validationResult = await _validator.ValidateAsync(existing);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        await _journalEntryService.UpdateAsync(existing);
        return Ok(ToDto(existing));
    }

    // DELETE: api/v1/JournalEntries/5
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _journalEntryService.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        await _journalEntryService.DeleteAsync(id);
        return NoContent();
    }

    private static JournalEntryResponseDto ToDto(JournalEntry entry) => new()
    {
        Id = entry.Id,
        Title = entry.Title,
        Summary = entry.Summary,
        Date = entry.Date,
        CreatedAt = entry.CreatedAt,
        UpdatedAt = entry.UpdatedAt,
        TodoTaskItemIds = entry.Todos.Select(t => t.Id),
        LogEntries = entry.LogEntries
            .OrderBy(l => l.CreatedAt)
            .ThenBy(l => l.Id)
            .Select(l => new JournalLogEntryResponseDto
            {
                Id = l.Id,
                Content = l.Content,
                JournalEntryId = l.JournalEntryId,
                CreatedAt = l.CreatedAt,
                UpdatedAt = l.UpdatedAt
            })
    };
}
