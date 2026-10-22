using FluentValidation;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Validators;

public class TaskItemValidator : AbstractValidator<TaskItem>
{
    public TaskItemValidator()
    {
        RuleFor(t => t.Title)
            .NotEmpty().WithMessage("Title is required.")
            .MaximumLength(100).WithMessage("Title must not exceed 100 characters.");

        RuleFor(t => t.Status)
            .IsInEnum()
            .WithMessage("Status must be a valid value (Draft, Todo, Blocked, or Completed).");

        RuleFor(t => t.BlockedReason)
            .MaximumLength(200).WithMessage("Blocked reason must not exceed 200 characters.");

        RuleFor(t => t)
            .Must(t => t.BlockedReason is null && t.BlockedAt is null && t.PreviousStatus is null)
            .When(t => t.Status != Status.Blocked)
            .WithName(nameof(TaskItem.Status))
            .WithMessage("Blocked details can only be set while the task is Blocked.");

        RuleFor(t => t.Priority)
            .IsInEnum()
            .WithMessage("Priority must be a valid value (Low, Medium, or High).");
    }
}
