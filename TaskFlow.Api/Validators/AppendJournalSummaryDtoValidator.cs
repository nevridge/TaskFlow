using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class AppendJournalSummaryDtoValidator : AbstractValidator<AppendJournalSummaryDto>
{
    public AppendJournalSummaryDtoValidator()
    {
        RuleFor(x => x.Text)
            .Must(text => !string.IsNullOrWhiteSpace(text))
            .WithMessage("Text is required.");
    }
}
