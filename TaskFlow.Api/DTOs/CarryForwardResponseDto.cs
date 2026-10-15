namespace TaskFlow.Api.DTOs;

public class CarryForwardResponseDto
{
    public int MovedCount { get; set; }
    public IEnumerable<int> MovedTaskItemIds { get; set; } = [];
}
