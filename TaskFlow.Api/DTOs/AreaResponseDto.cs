namespace TaskFlow.Api.DTOs;

public class AreaResponseDto
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public int DisplayOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Projects in the area, archived ones included.</summary>
    public int ProjectCount { get; set; }
}
