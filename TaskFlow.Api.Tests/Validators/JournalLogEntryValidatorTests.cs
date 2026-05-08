using FluentAssertions;
using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class JournalLogEntryValidatorTests
{
    private readonly JournalLogEntryValidator _validator = new();

    [Fact]
    public async Task Validate_ShouldPass_WhenLogEntryIsValid()
    {
        var logEntry = new JournalLogEntry { Content = "Worked on the journal feature", JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(logEntry);

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenContentIsEmpty()
    {
        var logEntry = new JournalLogEntry { Content = string.Empty, JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(logEntry);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCount(1);
        result.Errors[0].PropertyName.Should().Be("Content");
        result.Errors[0].ErrorMessage.Should().Be("Content is required.");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenContentExceedsMaxLength()
    {
        var logEntry = new JournalLogEntry { Content = new string('x', 2001), JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(logEntry);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCount(1);
        result.Errors[0].PropertyName.Should().Be("Content");
        result.Errors[0].ErrorMessage.Should().Be("Content must not exceed 2000 characters.");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenContentIsExactlyMaxLength()
    {
        var logEntry = new JournalLogEntry { Content = new string('x', 2000), JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(logEntry);

        result.IsValid.Should().BeTrue();
    }
}
