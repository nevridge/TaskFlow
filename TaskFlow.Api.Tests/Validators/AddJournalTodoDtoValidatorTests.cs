using FluentAssertions;
using FluentValidation;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class AddJournalTodoDtoValidatorTests
{
    private readonly IValidator<AddJournalTodoDto> _validator = new AddJournalTodoDtoValidator();

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-100)]
    public async Task Validate_ShouldFail_WhenTaskItemIdIsNotPositive(int id)
    {
        var result = await _validator.ValidateAsync(new AddJournalTodoDto { TaskItemId = id });

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle(e =>
            e.PropertyName == "TaskItemId" &&
            e.ErrorMessage == "TaskItemId must be greater than 0.");
    }

    [Theory]
    [InlineData(1)]
    [InlineData(42)]
    public async Task Validate_ShouldPass_WhenTaskItemIdIsPositive(int id)
    {
        var result = await _validator.ValidateAsync(new AddJournalTodoDto { TaskItemId = id });

        result.IsValid.Should().BeTrue();
    }
}
