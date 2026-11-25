namespace TaskFlow.Api.Models;

public class Area
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public int DisplayOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public ICollection<Project> Projects { get; set; } = [];
}
