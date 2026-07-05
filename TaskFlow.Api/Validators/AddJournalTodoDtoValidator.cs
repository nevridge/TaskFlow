using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class AddJournalTodoDtoValidator : AbstractValidator<AddJournalTodoDto>
{
    public AddJournalTodoDtoValidator()
    {
        RuleFor(x => x.TaskItemId).GreaterThan(0).WithMessage("TaskItemId must be greater than 0.");

        RuleFor(x => x.TimezoneOffsetMinutes)
            .InclusiveBetween(-720, 840)
            .WithMessage("TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).")
            .When(x => x.TimezoneOffsetMinutes.HasValue);
    }
}
