using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
public class TaskItemsController(ITaskRepository repo, IValidator<TaskItem> validator) : ControllerBase
{
    private const string ApiVersionString = "1.0";
    private readonly ITaskRepository _repo = repo;
    private readonly IValidator<TaskItem> _validator = validator;

    // GET: api/v1/TaskItems
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetAll()
    {
        var items = await _repo.GetAllAsync();
        var dtos = items.Select(i => new TaskItemResponseDto
        {
            Id = i.Id,
            Title = i.Title,
            Description = i.Description,
            IsComplete = i.IsComplete,
            DueDate = i.DueDate,
            Status = i.Status.ToString(),
            Priority = i.Priority.ToString()
        });
        return Ok(dtos);
    }

    // GET: api/v1/TaskItems/5
    [HttpGet("{id}", Name = "GetTaskV1")]
    public async Task<ActionResult<TaskItemResponseDto>> Get(int id)
    {
        var item = await _repo.GetByIdAsync(id);
        if (item is null)
        {
            return NotFound();
        }

        var dto = new TaskItemResponseDto
        {
            Id = item.Id,
            Title = item.Title,
            Description = item.Description,
            IsComplete = item.IsComplete,
            DueDate = item.DueDate,
            Status = item.Status.ToString(),
            Priority = item.Priority.ToString()
        };
        return Ok(dto);
    }

    // POST: api/v1/TaskItems
    [HttpPost]
    public async Task<ActionResult<TaskItemResponseDto>> Create([FromBody] CreateTaskItemDto createDto)
    {
        var item = new TaskItem
        {
            Title = createDto.Title,
            Description = createDto.Description,
            Status = createDto.Status,
            IsComplete = createDto.IsComplete,
            Priority = createDto.Priority,
            DueDate = createDto.DueDate
        };

        var validationResult = await _validator.ValidateAsync(item);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var createdItem = await _repo.AddAsync(item);

        var responseDto = new TaskItemResponseDto
        {
            Id = createdItem.Id,
            Title = createdItem.Title,
            Description = createdItem.Description,
            IsComplete = createdItem.IsComplete,
            DueDate = createdItem.DueDate,
            Status = createdItem.Status.ToString(),
            Priority = createdItem.Priority.ToString()
        };

        return CreatedAtRoute("GetTaskV1", new { version = ApiVersionString, id = createdItem.Id }, responseDto);
    }

    // PUT: api/v1/TaskItems/5
    [HttpPut("{id}")]
    public async Task<ActionResult<TaskItemResponseDto>> Update(int id, [FromBody] UpdateTaskItemDto updateDto)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        // Apply incoming changes
        existing.Title = updateDto.Title;
        existing.Description = updateDto.Description;
        existing.IsComplete = updateDto.IsComplete;
        existing.Status = updateDto.Status ?? existing.Status;
        existing.Priority = updateDto.Priority ?? existing.Priority;
        existing.DueDate = updateDto.DueDate;

        var validationResult = await _validator.ValidateAsync(existing);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        await _repo.UpdateAsync(existing);

        var responseDto = new TaskItemResponseDto
        {
            Id = existing.Id,
            Title = existing.Title,
            Description = existing.Description,
            IsComplete = existing.IsComplete,
            DueDate = existing.DueDate,
            Status = existing.Status.ToString(),
            Priority = existing.Priority.ToString()
        };

        return Ok(responseDto); // Return 200 OK with the updated resource
    }

    // DELETE: api/v1/TaskItems/5
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        await _repo.DeleteAsync(id);
        return NoContent();
    }
}
