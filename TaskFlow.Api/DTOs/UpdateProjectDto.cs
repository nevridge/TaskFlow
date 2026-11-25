namespace TaskFlow.Api.DTOs;

public class UpdateProjectDto
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsArchived { get; set; }

    /// <summary>Full replace: null or omitted removes the project from its area.</summary>
    public int? AreaId { get; set; }
}
