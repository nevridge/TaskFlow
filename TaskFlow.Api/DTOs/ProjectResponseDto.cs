namespace TaskFlow.Api.DTOs;

public class ProjectResponseDto
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public bool IsArchived { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int OpenTaskCount { get; set; }
    public int CompletedTaskCount { get; set; }
}
