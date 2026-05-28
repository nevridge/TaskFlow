using FluentValidation;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Validators;

public class JournalNoteValidator : AbstractValidator<JournalNote>
{
    public JournalNoteValidator()
    {
        RuleFor(n => n.Content)
            .NotEmpty().WithMessage("Content is required.");
    }
}
