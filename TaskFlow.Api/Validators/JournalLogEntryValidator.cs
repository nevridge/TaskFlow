using FluentValidation;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Validators;

public class JournalLogEntryValidator : AbstractValidator<JournalLogEntry>
{
    public JournalLogEntryValidator()
    {
        RuleFor(e => e.Content)
            .NotEmpty().WithMessage("Content is required.")
            .MaximumLength(2000).WithMessage("Content must not exceed 2000 characters.");
    }
}
