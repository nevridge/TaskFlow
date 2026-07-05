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

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    [InlineData(999999)]
    public async Task Validate_ShouldFail_WhenTimezoneOffsetMinutesIsOutOfRange(int value)
    {
        var result = await _validator.ValidateAsync(new AddJournalTodoDto { TaskItemId = 1, TimezoneOffsetMinutes = value });

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle(e =>
            e.PropertyName == "TimezoneOffsetMinutes" &&
            e.ErrorMessage == "TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).");
    }

    [Theory]
    [InlineData(-720)]
    [InlineData(840)]
    [InlineData(0)]
    public async Task Validate_ShouldPass_WhenTimezoneOffsetMinutesIsWithinRange(int value)
    {
        var result = await _validator.ValidateAsync(new AddJournalTodoDto { TaskItemId = 1, TimezoneOffsetMinutes = value });

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTimezoneOffsetMinutesIsNull()
    {
        var result = await _validator.ValidateAsync(new AddJournalTodoDto { TaskItemId = 1, TimezoneOffsetMinutes = null });

        result.IsValid.Should().BeTrue();
    }
}
