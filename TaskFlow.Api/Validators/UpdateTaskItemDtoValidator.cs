using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class UpdateTaskItemDtoValidator : AbstractValidator<UpdateTaskItemDto>
{
    public UpdateTaskItemDtoValidator()
    {
        RuleFor(x => x.TimezoneOffsetMinutes)
            .InclusiveBetween(-720, 840)
            .WithMessage("TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).");
    }
}
