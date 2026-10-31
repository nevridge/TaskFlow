using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

/// <summary>The tasks that are todo rows on one journal day (roots and subtasks), with the day's date.</summary>
public record JournalDayTodos(DateOnly EntryDate, IReadOnlyList<TaskItem> Tasks);

/// <summary>What a rejected link of a completed task needs to describe itself in the 422 body.</summary>
public record PlanCompletedDetails(DateOnly? AssignedDate, DateTime? CompletedAt, DateOnly JournalDate);
