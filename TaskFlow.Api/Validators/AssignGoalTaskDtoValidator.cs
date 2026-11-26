using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class AssignGoalTaskDtoValidator : AbstractValidator<AssignGoalTaskDto>
{
    public AssignGoalTaskDtoValidator()
    {
        RuleFor(x => x.TaskItemId).GreaterThan(0).WithMessage("TaskItemId must be greater than 0.");
    }
}
