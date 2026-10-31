namespace TaskFlow.Api.Models;

public class TaskItem
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public Priority Priority { get; set; } = Priority.Low;
    public Status Status { get; set; } = Status.Draft;
    public DateOnly? DueDate { get; set; }

    // Blocked-state fields. Invariant: when Status != Blocked all three are null;
    // when Status == Blocked, BlockedAt and PreviousStatus are non-null.
    public string? BlockedReason { get; set; }
    public DateTime? BlockedAt { get; set; }
    public Status? PreviousStatus { get; set; }

    // Server-owned: set the first time the task enters InProgress; never cleared.
    public DateTime? StartedAt { get; set; }

    // Server-owned UTC instant of the transition to Completed; cleared on reopen. Written only in TaskRepository.
    public DateTime? CompletedAt { get; set; }
    public DateOnly? FirstTaggedDate { get; set; }
    public int MoveCount { get; set; }
    public int? ParentTaskItemId { get; set; }
    public TaskItem? ParentTaskItem { get; set; }
    public ICollection<TaskItem> ChildTaskItems { get; set; } = [];
    public int? ProjectId { get; set; }
    public Project? Project { get; set; }
    public int? CurrentJournalEntryId { get; set; }
    public JournalEntry? CurrentJournalEntry { get; set; }
    public ICollection<TaskItemEvent> Events { get; set; } = [];
    public ICollection<Note> Notes { get; set; } = [];
}
