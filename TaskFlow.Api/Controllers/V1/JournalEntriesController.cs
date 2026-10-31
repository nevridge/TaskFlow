using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Mappers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion(ApiVersions.V1)]
[Route("api/v{version:apiVersion}/[controller]")]
public class JournalEntriesController(
    IJournalEntryRepository journalRepo,
    IValidator<JournalEntry> validator,
    IValidator<CreateJournalEntryDto> createValidator,
    IValidator<CarryForwardRequestDto> carryForwardValidator,
    IValidator<JournalDayQueryDto> queryValidator) : ControllerBase
{
    private readonly IValidator<JournalDayQueryDto> _queryValidator = queryValidator;
    private readonly IValidator<CreateJournalEntryDto> _createValidator = createValidator;
    private readonly IValidator<CarryForwardRequestDto> _carryForwardValidator = carryForwardValidator;
    private const string GetRouteEntryName = "GetJournalEntryV1";
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
    private readonly IValidator<JournalEntry> _validator = validator;

    // GET: api/v1/JournalEntries
    // TodoTaskItemIds are the root tasks that are todos on each entry's day (see JournalDayRule); the optional
    // timezoneOffsetMinutes turns completion instants into local days (UTC when omitted).
    [HttpGet]
    public async Task<ActionResult<IEnumerable<JournalEntryResponseDto>>> GetAll([FromQuery] JournalDayQueryDto query)
    {
        var queryValidation = await _queryValidator.ValidateAsync(query);
        if (!queryValidation.IsValid)
        {
            return BadRequest(queryValidation.Errors);
        }

        var entries = (await _journalRepo.GetAllAsync()).ToList();
        return Ok(await ToDtosAsync(entries, query.TimezoneOffsetMinutes));
    }

    // GET: api/v1/JournalEntries/5
    [HttpGet("{id}", Name = GetRouteEntryName)]
    public async Task<ActionResult<JournalEntryResponseDto>> Get(int id, [FromQuery] JournalDayQueryDto query)
    {
        var queryValidation = await _queryValidator.ValidateAsync(query);
        if (!queryValidation.IsValid)
        {
            return BadRequest(queryValidation.Errors);
        }

        var entry = await _journalRepo.GetByIdAsync(id);
        if (entry is null)
        {
            return NotFound();
        }

        return Ok(await ToDtoAsync(entry, query.TimezoneOffsetMinutes));
    }

    // POST: api/v1/JournalEntries
    [HttpPost]
    public async Task<ActionResult<JournalEntryResponseDto>> Create([FromBody] CreateJournalEntryDto dto)
    {
        var dtoValidation = await _createValidator.ValidateAsync(dto);
        if (!dtoValidation.IsValid)
        {
            return BadRequest(dtoValidation.Errors);
        }

        var existingByDate = await _journalRepo.GetByDateAsync(dto.Date);
        if (existingByDate is not null)
        {
            return Conflict(new
            {
                message = "A journal entry already exists for this date.",
                existingEntry = await ToDtoAsync(existingByDate, dto.TimezoneOffsetMinutes)
            });
        }

        var entry = new JournalEntry { Title = dto.Title, Summary = dto.Summary, Date = dto.Date };

        var validation = await _validator.ValidateAsync(entry);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
        }

        try
        {
            var created = await _journalRepo.AddAsync(entry);
            IReadOnlyList<int> moved = [];

            // Carry-forward only when the entry is the user's today and an offset was supplied (no UTC fallback).
            if (dto.TimezoneOffsetMinutes.HasValue
                && dto.Date == UserDateHelper.GetUserToday(DateTime.UtcNow, dto.TimezoneOffsetMinutes))
            {
                moved = await _journalRepo.CarryForwardIncompleteTasksAsync(created.Id, dto.Date);

                // Always re-read: a lost race returns empty but leaves the unsaved moves on the tracked entity.
                created = await _journalRepo.GetByIdAsync(created.Id) ?? created;
            }

            var response = await ToDtoAsync(created, dto.TimezoneOffsetMinutes);
            response.MovedCount = moved.Count;
            response.MovedTaskItemIds = moved;
            return CreatedAtRoute(GetRouteEntryName, new { version = ApiVersions.V1, id = created.Id }, response);
        }
        catch (DuplicateJournalDateException)
        {
            var existing = await _journalRepo.GetByDateAsync(dto.Date);
            return Conflict(new
            {
                message = "A journal entry for this date was created by another request.",
                existingEntry = existing is null ? null : await ToDtoAsync(existing, dto.TimezoneOffsetMinutes),
            });
        }
    }

    // POST: api/v1/JournalEntries/5/carry-forward
    [HttpPost("{id}/carry-forward")]
    public async Task<ActionResult<CarryForwardResponseDto>> CarryForward(int id, [FromBody] CarryForwardRequestDto? dto = null)
    {
        dto ??= new CarryForwardRequestDto();

        var validation = await _carryForwardValidator.ValidateAsync(dto);
        if (!validation.IsValid)
        {
            return BadRequest(validation.Errors);
        }

        var entry = await _journalRepo.GetByIdAsync(id);
        if (entry is null)
        {
            return NotFound();
        }

        if (!dto.TimezoneOffsetMinutes.HasValue)
        {
            return Ok(new CarryForwardResponseDto { MovedCount = 0, MovedTaskItemIds = [] });
        }

        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, dto.TimezoneOffsetMinutes);
        if (entry.Date != userToday)
        {
            return Ok(new CarryForwardResponseDto { MovedCount = 0, MovedTaskItemIds = [] });
        }

        var moved = await _journalRepo.CarryForwardIncompleteTasksAsync(id, userToday);
        return Ok(new CarryForwardResponseDto { MovedCount = moved.Count, MovedTaskItemIds = moved });
    }

    // PUT: api/v1/JournalEntries/5
    [HttpPut("{id}")]
    public async Task<ActionResult<JournalEntryResponseDto>> Update(int id, [FromBody] UpdateJournalEntryDto dto)
    {
        var existing = await _journalRepo.GetByIdAsync(id);
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

        await _journalRepo.UpdateAsync(existing);
        // The update request carries no offset, so todo ids are attributed to UTC days.
        return Ok(await ToDtoAsync(existing, null));
    }

    // DELETE: api/v1/JournalEntries/5
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _journalRepo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        await _journalRepo.DeleteAsync(id);
        return NoContent();
    }

    private async Task<JournalEntryResponseDto> ToDtoAsync(JournalEntry entry, int? offsetMinutes) =>
        (await ToDtosAsync([entry], offsetMinutes)).Single();

    // Every entry's todo ids come from one batched repository query, never from the raw Todos join.
    private async Task<List<JournalEntryResponseDto>> ToDtosAsync(IReadOnlyCollection<JournalEntry> entries, int? offsetMinutes)
    {
        var todoIds = await _journalRepo.GetTodoTaskItemIdsAsync(
            entries.Select(e => (e.Id, e.Date)).ToList(), offsetMinutes);
        return entries
            .Select(e => ToDto(e, todoIds.TryGetValue(e.Id, out var ids) ? ids : []))
            .ToList();
    }

    private static JournalEntryResponseDto ToDto(JournalEntry e, IReadOnlyCollection<int> todoIds) => new()
    {
        Id = e.Id,
        Title = e.Title,
        Summary = e.Summary,
        Date = e.Date,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt,
        TodoTaskItemIds = todoIds,
        LogEntries = e.LogEntries.OrderBy(l => l.CreatedAt).Select(JournalLogEntryMapper.ToDto),
    };
}
