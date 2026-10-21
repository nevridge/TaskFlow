using TaskFlow.Api.DTOs;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class CarryForwardRequestDtoValidatorTests
{
    private readonly CarryForwardRequestDtoValidator _validator = new();

    [Theory]
    [InlineData(null)]
    [InlineData(-720)]
    [InlineData(0)]
    [InlineData(840)]
    public void Validate_ShouldBeValid_ForNullOrInRangeOffset(int? offset)
    {
        Assert.True(_validator.Validate(new CarryForwardRequestDto { TimezoneOffsetMinutes = offset }).IsValid);
    }

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    public void Validate_ShouldBeInvalid_ForOutOfRangeOffset(int offset)
    {
        Assert.False(_validator.Validate(new CarryForwardRequestDto { TimezoneOffsetMinutes = offset }).IsValid);
    }
}
