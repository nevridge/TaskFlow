using FluentValidation;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Validators;

public class GoalValidator : AbstractValidator<Goal>
{
    public GoalValidator()
    {
        RuleFor(g => g.Title)
            .NotEmpty().WithMessage("Title is required.")
            .MaximumLength(100).WithMessage("Title must not exceed 100 characters.");

        RuleFor(g => g.Status)
            .IsInEnum()
            .WithMessage("Status must be a valid value (Next, Now, Parked, Done, or Dropped).");

        RuleFor(g => g.ParkedReason)
            .MaximumLength(200).WithMessage("Parked reason must not exceed 200 characters.");
    }
}
