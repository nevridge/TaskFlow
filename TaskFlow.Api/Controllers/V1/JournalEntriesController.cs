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
public class JournalEntriesController(IJournalEntryService journalService, IValidator<JournalEntry> validator) : ControllerBase
{
    private const string GetRouteEntryName = "GetJournalEntryV1";
    private const string ApiVersionString = "1.0";
    private readonly IJournalEntryService _journalService = journalService;
    private readonly IValidator<JournalEntry> _validator = validator;

    // GET: api/v1/JournalEntries
    [HttpGet]
    public async Task<ActionResult<IEnumerable<JournalEntryResponseDto>>> GetAll()
    {
        var entries = await _journalService.GetAllAsync();
        return Ok(entries.Select(ToDto));
    }

    // GET: api/v1/JournalEntries/5
    [HttpGet("{id}", Name = GetRouteEntryName)]
    public async Task<ActionResult<JournalEntryResponseDto>> Get(int id)
    {
        var entry = await _journalService.GetByIdAsync(id);
        if (entry is null)
        {
            return NotFound();
        }

        return Ok(ToDto(entry));
    }

    // POST: api/v1/JournalEntries
    [HttpPost]
    public async Task<ActionResult<JournalEntryResponseDto>> Create([FromBody] CreateJournalEntryDto dto)
    {
        var entry = new JournalEntry { Title = dto.Title, Summary = dto.Summary, Date = dto.Date };

        var validation = await _validator.ValidateAsync(entry);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
        }

        var created = await _journalService.CreateAsync(entry);
        return CreatedAtRoute(GetRouteEntryName, new { version = ApiVersionString, id = created.Id }, ToDto(created));
    }

    // PUT: api/v1/JournalEntries/5
    [HttpPut("{id}")]
    public async Task<ActionResult<JournalEntryResponseDto>> Update(int id, [FromBody] UpdateJournalEntryDto dto)
    {
        var existing = await _journalService.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        existing.Title = dto.Title;
        existing.Summary = dto.Summary;

        var validation = await _validator.ValidateAsync(existing);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
        }

        await _journalService.UpdateAsync(existing);
        return Ok(ToDto(existing));
    }

    // DELETE: api/v1/JournalEntries/5
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _journalService.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        await _journalService.DeleteAsync(id);
        return NoContent();
    }

    private static JournalEntryResponseDto ToDto(JournalEntry e) => new()
    {
        Id = e.Id,
        Title = e.Title,
        Summary = e.Summary,
        Date = e.Date,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt,
        TodoTaskItemIds = e.Todos.Select(t => t.Id),
        LogEntries = e.LogEntries.OrderBy(l => l.CreatedAt).Select(l => new JournalLogEntryResponseDto
        {
            Id = l.Id,
            Content = l.Content,
            JournalEntryId = l.JournalEntryId,
            CreatedAt = l.CreatedAt,
            UpdatedAt = l.UpdatedAt,
        }),
    };
}
