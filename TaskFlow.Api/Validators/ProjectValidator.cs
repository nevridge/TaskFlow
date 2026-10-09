using FluentValidation;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Validators;

public class ProjectValidator : AbstractValidator<Project>
{
    public ProjectValidator()
    {
        RuleFor(p => p.Name)
            .NotEmpty().WithMessage("Name is required.")
            .MaximumLength(100).WithMessage("Name must not exceed 100 characters.");

        RuleFor(p => p.Description)
            .MaximumLength(2000).WithMessage("Description must not exceed 2000 characters.");
    }
}
