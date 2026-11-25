using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion(ApiVersions.V1)]
[Route("api/v{version:apiVersion}/[controller]")]
public class AreasController(IAreaRepository repo, IValidator<Area> validator) : ControllerBase
{
    private const string GetAreaRouteName = "GetAreaV1";
    private const string DuplicateNameMessage = "An area with this name already exists.";
    private readonly IAreaRepository _repo = repo;
    private readonly IValidator<Area> _validator = validator;

    // GET: api/v1/Areas
    [HttpGet]
    public async Task<ActionResult<IEnumerable<AreaResponseDto>>> GetAll()
    {
        var areas = await _repo.GetAllAsync();
        return Ok(areas.Select(ToDto));
    }

    // GET: api/v1/Areas/5
    [HttpGet("{id}", Name = GetAreaRouteName)]
    public async Task<ActionResult<AreaResponseDto>> Get(int id)
    {
        var area = await _repo.GetByIdNoTrackingAsync(id);
        if (area is null)
        {
            return NotFound();
        }

        return Ok(ToDto(area));
    }

    // POST: api/v1/Areas
    [HttpPost]
    public async Task<ActionResult<AreaResponseDto>> Create([FromBody] CreateAreaDto createDto)
    {
        var area = new Area { Name = createDto.Name?.Trim() ?? string.Empty };

        var validationResult = await _validator.ValidateAsync(area);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        if (await _repo.NameExistsAsync(area.Name))
        {
            return Conflict(new { message = DuplicateNameMessage });
        }

        var created = await _repo.AddAsync(area);
        return CreatedAtRoute(GetAreaRouteName, new { version = ApiVersions.V1, id = created.Id }, ToDto(created));
    }

    // PUT: api/v1/Areas/5
    [HttpPut("{id}")]
    public async Task<ActionResult<AreaResponseDto>> Update(int id, [FromBody] UpdateAreaDto updateDto)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        existing.Name = updateDto.Name?.Trim() ?? string.Empty;

        var validationResult = await _validator.ValidateAsync(existing);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        if (await _repo.NameExistsAsync(existing.Name, id))
        {
            return Conflict(new { message = DuplicateNameMessage });
        }

        await _repo.UpdateAsync(existing);
        return Ok(ToDto(existing));
    }

    // PUT: api/v1/Areas/order  (the literal segment takes precedence over {id})
    [HttpPut("order")]
    public async Task<ActionResult<IEnumerable<AreaResponseDto>>> Reorder([FromBody] ReorderAreasDto reorderDto)
    {
        if (!await _repo.ReorderAsync(reorderDto.AreaIds))
        {
            return BadRequest(new { message = "The list must contain every area id exactly once." });
        }

        var areas = await _repo.GetAllAsync();
        return Ok(areas.Select(ToDto));
    }

    // DELETE: api/v1/Areas/5?moveToAreaId=2 | ?newAreaName=Home | ?noArea=true
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(
        int id,
        [FromQuery] int? moveToAreaId = null,
        [FromQuery] string? newAreaName = null,
        [FromQuery] bool noArea = false)
    {
        var newName = string.IsNullOrWhiteSpace(newAreaName) ? null : newAreaName.Trim();

        var choices = (moveToAreaId is null ? 0 : 1) + (newName is null ? 0 : 1) + (noArea ? 1 : 0);
        if (choices > 1)
        {
            return BadRequest(new { message = "Choose only one of moveToAreaId, newAreaName or noArea=true." });
        }

        if (moveToAreaId == id)
        {
            return BadRequest(new { message = "moveToAreaId must be a different area from the one being deleted." });
        }

        if (newName is not null)
        {
            var validationResult = await _validator.ValidateAsync(new Area { Name = newName });
            if (!validationResult.IsValid)
            {
                return BadRequest(validationResult.Errors);
            }
        }

        var result = await _repo.DeleteAsync(id, moveToAreaId, newName, noArea);
        return result switch
        {
            DeleteAreaResult.NotFound => NotFound(),
            DeleteAreaResult.HasProjects => Conflict(new
            {
                message = "This area has projects. Choose where they go: moveToAreaId, newAreaName or noArea=true.",
            }),
            DeleteAreaResult.TargetNotFound => BadRequest(new { message = "Target area not found." }),
            DeleteAreaResult.NameTaken => Conflict(new { message = DuplicateNameMessage }),
            _ => NoContent(),
        };
    }

    private static AreaResponseDto ToDto(Area area) => new()
    {
        Id = area.Id,
        Name = area.Name,
        DisplayOrder = area.DisplayOrder,
        CreatedAt = area.CreatedAt,
        UpdatedAt = area.UpdatedAt,
        ProjectCount = area.Projects.Count,
    };
}
