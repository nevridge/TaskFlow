using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/TaskItems/{taskId}/notes")]
public class NotesController(INoteRepository noteRepo, ITaskRepository taskRepo, IValidator<Note> validator) : ControllerBase
{
    private const string GetNoteRouteName = "GetNoteV1";
    private const string ApiVersionString = "1.0";
    private readonly INoteRepository _noteRepo = noteRepo;
    private readonly ITaskRepository _taskRepo = taskRepo;
    private readonly IValidator<Note> _validator = validator;

    // GET: api/v1/TaskItems/{taskId}/notes
    [HttpGet]
    public async Task<ActionResult<IEnumerable<NoteResponseDto>>> GetAll(int taskId)
    {
        var task = await _taskRepo.GetByIdAsync(taskId);
        if (task is null)
        {
            return NotFound();
        }

        var notes = await _noteRepo.GetAllByTaskIdAsync(taskId);
        return Ok(notes.Select(ToDto));
    }

    // GET: api/v1/TaskItems/{taskId}/notes/{id}
    [HttpGet("{id}", Name = GetNoteRouteName)]
    public async Task<ActionResult<NoteResponseDto>> Get(int taskId, int id)
    {
        var task = await _taskRepo.GetByIdAsync(taskId);
        if (task is null)
        {
            return NotFound();
        }

        var note = await _noteRepo.GetByIdAsync(taskId, id);
        if (note is null)
        {
            return NotFound();
        }

        return Ok(ToDto(note));
    }

    // POST: api/v1/taskitems/{taskId}/notes
    [HttpPost]
    public async Task<ActionResult<NoteResponseDto>> Create(int taskId, [FromBody] CreateNoteDto createDto)
    {
        var task = await _taskRepo.GetByIdAsync(taskId);
        if (task is null)
        {
            return NotFound();
        }

        var note = new Note { Content = createDto.Content, TaskItemId = taskId };

        var validationResult = await _validator.ValidateAsync(note);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var created = await _noteRepo.AddAsync(note);
        return CreatedAtRoute(GetNoteRouteName, new { version = ApiVersionString, taskId, id = created.Id }, ToDto(created));
    }

    // PUT: api/v1/taskitems/{taskId}/notes/{id}
    [HttpPut("{id}")]
    public async Task<ActionResult<NoteResponseDto>> Update(int taskId, int id, [FromBody] UpdateNoteDto updateDto)
    {
        var task = await _taskRepo.GetByIdAsync(taskId);
        if (task is null)
        {
            return NotFound();
        }

        var existing = await _noteRepo.GetByIdAsync(taskId, id);
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

        await _noteRepo.UpdateAsync(existing);
        return Ok(ToDto(existing));
    }

    // DELETE: api/v1/taskitems/{taskId}/notes/{id}
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int taskId, int id)
    {
        var task = await _taskRepo.GetByIdAsync(taskId);
        if (task is null)
        {
            return NotFound();
        }

        var existing = await _noteRepo.GetByIdAsync(taskId, id);
        if (existing is null)
        {
            return NotFound();
        }

        await _noteRepo.DeleteAsync(taskId, id);
        return NoContent();
    }

    private static NoteResponseDto ToDto(Note note) => new()
    {
        Id = note.Id,
        Content = note.Content,
        TaskItemId = note.TaskItemId,
        CreatedAt = note.CreatedAt,
        UpdatedAt = note.UpdatedAt
    };
}
