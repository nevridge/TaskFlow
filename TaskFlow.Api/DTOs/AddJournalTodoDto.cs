namespace TaskFlow.Api.DTOs;

public class AddJournalTodoDto
{
    public int TaskItemId { get; set; }
    public int? TimezoneOffsetMinutes { get; set; }
}
