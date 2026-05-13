namespace TaskFlow.Api.DTOs;

public class AddJournalTodoDto
{
    [System.ComponentModel.DataAnnotations.Range(1, int.MaxValue, ErrorMessage = "TaskItemId must be greater than 0.")]
    public int TaskItemId { get; set; }
}
