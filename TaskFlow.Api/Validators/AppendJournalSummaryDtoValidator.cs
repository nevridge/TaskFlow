using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class AppendJournalSummaryDtoValidator : AbstractValidator<AppendJournalSummaryDto>
{
    /// <summary>Same limit as <see cref="JournalEntryValidator"/> applies to the stored summary (10000).</summary>
    public const int MaxSummaryLength = 10000;

    public AppendJournalSummaryDtoValidator()
    {
        RuleFor(x => x.Text)
            .Must(text => !string.IsNullOrWhiteSpace(text))
            .WithMessage("Text is required.");
    }
}
