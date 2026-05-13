using FluentAssertions;
using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class JournalEntryValidatorTests
{
    private readonly JournalEntryValidator _validator = new();

    [Fact]
    public async Task Validate_ShouldFail_WhenDateIsDefault()
    {
        var entry = new JournalEntry { Title = "Entry", Date = default };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "Date" && e.ErrorMessage == "Date is required.");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenSummaryTooLong()
    {
        var entry = new JournalEntry { Title = "Entry", Date = new DateOnly(2026, 5, 10), Summary = new string('a', 10001) };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "Summary" && e.ErrorMessage == "Summary must not exceed 10000 characters.");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenValid()
    {
        var entry = new JournalEntry { Title = "Entry", Date = new DateOnly(2026, 5, 10), Summary = "Notes" };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeTrue();
    }
}
