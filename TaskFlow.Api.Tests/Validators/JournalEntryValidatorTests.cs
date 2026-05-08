using FluentAssertions;
using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class JournalEntryValidatorTests
{
    private readonly JournalEntryValidator _validator = new();

    [Fact]
    public async Task Validate_ShouldPass_WhenEntryIsValid()
    {
        var entry = new JournalEntry { Title = "Day 1", Date = new DateOnly(2026, 5, 7) };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenSummaryIsNull()
    {
        var entry = new JournalEntry { Title = "Day 1", Summary = null, Date = new DateOnly(2026, 5, 7) };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenSummaryIsProvided()
    {
        var entry = new JournalEntry { Title = "Day 1", Summary = "Good day", Date = new DateOnly(2026, 5, 7) };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenTitleIsEmpty()
    {
        var entry = new JournalEntry { Title = string.Empty, Date = new DateOnly(2026, 5, 7) };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCount(1);
        result.Errors[0].PropertyName.Should().Be("Title");
        result.Errors[0].ErrorMessage.Should().Be("Title is required.");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenTitleExceedsMaxLength()
    {
        var entry = new JournalEntry { Title = new string('x', 201), Date = new DateOnly(2026, 5, 7) };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCount(1);
        result.Errors[0].PropertyName.Should().Be("Title");
        result.Errors[0].ErrorMessage.Should().Be("Title must not exceed 200 characters.");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTitleIsExactlyMaxLength()
    {
        var entry = new JournalEntry { Title = new string('x', 200), Date = new DateOnly(2026, 5, 7) };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenDateIsDefault()
    {
        var entry = new JournalEntry { Title = "Day 1", Date = default };

        var result = await _validator.ValidateAsync(entry);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle(error =>
            error.PropertyName == "Date" &&
            error.ErrorMessage == "Date is required.");
    }
}
