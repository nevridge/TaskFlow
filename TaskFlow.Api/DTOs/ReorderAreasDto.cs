namespace TaskFlow.Api.DTOs;

public class ReorderAreasDto
{
    /// <summary>Every area id exactly once, in the wanted display order.</summary>
    public List<int> AreaIds { get; set; } = [];
}
