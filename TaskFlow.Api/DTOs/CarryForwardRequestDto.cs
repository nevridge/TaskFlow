namespace TaskFlow.Api.DTOs;

public class CarryForwardRequestDto
{
    /// <summary>Minutes ahead of UTC (e.g. -300 for UTC-5). Null means not supplied.</summary>
    public int? TimezoneOffsetMinutes { get; set; }
}
