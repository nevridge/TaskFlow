using FluentAssertions;
using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class JournalLogEntryValidatorTests
{
    private readonly JournalLogEntryValidator _validator = new();

    [Fact]
    public async Task Validate_ShouldFail_WhenContentIsEmpty()
    {
        var log = new JournalLogEntry { Content = string.Empty, JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(log);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "Content");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenValid()
    {
        var log = new JournalLogEntry { Content = "Did some work", JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(log);

        result.IsValid.Should().BeTrue();
    }
}
