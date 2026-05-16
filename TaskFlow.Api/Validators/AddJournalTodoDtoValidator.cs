using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class AddJournalTodoDtoValidator : AbstractValidator<AddJournalTodoDto>
{
    public AddJournalTodoDtoValidator()
    {
        RuleFor(x => x.TaskItemId).GreaterThan(0).WithMessage("TaskItemId must be greater than 0.");
    }
}
