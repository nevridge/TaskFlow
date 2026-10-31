using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class JournalDayQueryDtoValidator : AbstractValidator<JournalDayQueryDto>
{
    public JournalDayQueryDtoValidator()
    {
        RuleFor(x => x.TimezoneOffsetMinutes)
            .InclusiveBetween(TimezoneOffsetBounds.MinMinutes, TimezoneOffsetBounds.MaxMinutes)
            .When(x => x.TimezoneOffsetMinutes.HasValue)
            .WithMessage(TimezoneOffsetBounds.Message);
    }
}
