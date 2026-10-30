using FluentValidation;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class UpdateTaskItemDtoValidatorTests
{
    private readonly IValidator<UpdateTaskItemDto> _validator = new UpdateTaskItemDtoValidator();

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    [InlineData(-2000000000)]
    public async Task Validate_ShouldFail_WhenTimezoneOffsetMinutesIsOutOfRange(int value)
    {
        var result = await _validator.ValidateAsync(new UpdateTaskItemDto { TimezoneOffsetMinutes = value });

        Assert.False(result.IsValid);
        Assert.Single(result.Errors, e =>
            e.PropertyName == "TimezoneOffsetMinutes" &&
            e.ErrorMessage == "TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).");
    }

    [Theory]
    [InlineData(-720)]
    [InlineData(840)]
    [InlineData(0)]
    public async Task Validate_ShouldPass_WhenTimezoneOffsetMinutesIsWithinRange(int value)
    {
        var result = await _validator.ValidateAsync(new UpdateTaskItemDto { TimezoneOffsetMinutes = value });

        Assert.True(result.IsValid);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTimezoneOffsetMinutesIsNull()
    {
        var result = await _validator.ValidateAsync(new UpdateTaskItemDto { TimezoneOffsetMinutes = null });

        Assert.True(result.IsValid);
    }
}
