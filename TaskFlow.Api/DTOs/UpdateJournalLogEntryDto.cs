using System.Text.Json.Serialization;

namespace TaskFlow.Api.DTOs;

public class UpdateJournalLogEntryDto
{
    public required string Content { get; set; }
    // [JsonRequired] ensures an absent field is rejected (400) rather than
    // deserializing as null and silently clearing an existing task link.
    [JsonRequired]
    public int? TaskItemId { get; set; }
}
