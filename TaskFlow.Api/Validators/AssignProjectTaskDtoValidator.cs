using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class AssignProjectTaskDtoValidator : AbstractValidator<AssignProjectTaskDto>
{
    public AssignProjectTaskDtoValidator()
    {
        RuleFor(x => x.TaskItemId).GreaterThan(0).WithMessage("TaskItemId must be greater than 0.");
    }
}
