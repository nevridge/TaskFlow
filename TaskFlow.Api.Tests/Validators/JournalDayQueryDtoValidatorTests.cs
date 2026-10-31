using FluentValidation;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class JournalDayQueryDtoValidatorTests
{
    private readonly IValidator<JournalDayQueryDto> _validator = new JournalDayQueryDtoValidator();

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    [InlineData(999999)]
    public async Task Validate_ShouldFail_WhenTimezoneOffsetMinutesIsOutOfRange(int value)
    {
        var result = await _validator.ValidateAsync(new JournalDayQueryDto { TimezoneOffsetMinutes = value });

        Assert.False(result.IsValid);
        Assert.Single(result.Errors, e =>
            e.PropertyName == "TimezoneOffsetMinutes" &&
            e.ErrorMessage == "TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).");
    }

    [Theory]
    [InlineData(-720)]
    [InlineData(840)]
    [InlineData(0)]
    [InlineData(-300)]
    public async Task Validate_ShouldPass_WhenTimezoneOffsetMinutesIsWithinRange(int value)
    {
        var result = await _validator.ValidateAsync(new JournalDayQueryDto { TimezoneOffsetMinutes = value });

        Assert.True(result.IsValid);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTimezoneOffsetMinutesIsNull()
    {
        var result = await _validator.ValidateAsync(new JournalDayQueryDto());

        Assert.True(result.IsValid);
    }

    [Fact]
    public async Task Validate_ShouldUseSameMessageAsAddJournalTodoDtoValidator()
    {
        var query = await _validator.ValidateAsync(new JournalDayQueryDto { TimezoneOffsetMinutes = 900 });
        var add = await new AddJournalTodoDtoValidator().ValidateAsync(new AddJournalTodoDto { TaskItemId = 1, TimezoneOffsetMinutes = 900 });

        Assert.Equal(add.Errors.Single().ErrorMessage, query.Errors.Single().ErrorMessage);
    }
}
