using Microsoft.AspNetCore.Mvc;

namespace TaskFlow.Api.DTOs;

/// <summary>Query string shared by the journal reads that attribute tasks to a day.</summary>
public class JournalDayQueryDto
{
    /// <summary>
    /// The viewer's UTC offset in minutes (-720..840), used to turn a completion instant into a local day.
    /// Omitted means UTC.
    /// </summary>
    [FromQuery(Name = "timezoneOffsetMinutes")]
    public int? TimezoneOffsetMinutes { get; set; }
}
