using TaskFlow.Api.Models;

namespace TaskFlow.Api.DTOs;

public class UpdateTaskItemDto
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Status? Status { get; set; }
    public bool IsComplete { get; set; }
    public Priority? Priority { get; set; }
    public DateTime? DueDate { get; set; }
    public int? ParentTaskItemId { get; set; }
}
