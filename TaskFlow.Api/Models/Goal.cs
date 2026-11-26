using TaskFlow.Contracts;

namespace TaskFlow.Api.Models;

public class Goal
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public Project? Project { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public string? DoneWhen { get; set; }
    public GoalStatus Status { get; set; } = GoalStatus.Next;
    public string? ParkedReason { get; set; }

    // Meaningful only while Status is Next.
    public int DisplayOrder { get; set; }

    // Server-owned UTC instants, written only in GoalRepository. ClosedAt is set only while Done or Dropped.
    public DateTime StatusChangedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public ICollection<TaskItem> Tasks { get; set; } = [];
}
