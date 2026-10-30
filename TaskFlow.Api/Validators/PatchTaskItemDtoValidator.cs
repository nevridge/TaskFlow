using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class PatchTaskItemDtoValidator : AbstractValidator<PatchTaskItemDto>
{
    public PatchTaskItemDtoValidator()
    {
        RuleFor(x => x.TimezoneOffsetMinutes)
            .InclusiveBetween(-720, 840)
            .WithMessage("TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).");
    }
}
