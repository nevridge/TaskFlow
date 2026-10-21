using TaskFlow.Api.DTOs;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class CreateJournalEntryDtoValidatorTests
{
    private readonly CreateJournalEntryDtoValidator _validator = new();

    [Theory]
    [InlineData(null)]
    [InlineData(-720)]
    [InlineData(0)]
    [InlineData(840)]
    public void Validate_ShouldBeValid_ForNullOrInRangeOffset(int? offset)
    {
        var result = _validator.Validate(new CreateJournalEntryDto { Title = "t", TimezoneOffsetMinutes = offset });

        Assert.True(result.IsValid);
    }

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    public void Validate_ShouldBeInvalid_ForOutOfRangeOffset(int offset)
    {
        var result = _validator.Validate(new CreateJournalEntryDto { Title = "t", TimezoneOffsetMinutes = offset });

        Assert.False(result.IsValid);
    }
}
