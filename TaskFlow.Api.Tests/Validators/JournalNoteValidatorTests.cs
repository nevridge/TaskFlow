using FluentAssertions;
using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class JournalNoteValidatorTests
{
    private readonly JournalNoteValidator _validator = new();

    [Fact]
    public async Task Validate_ShouldPass_WhenContentProvided()
    {
        var note = new JournalNote { Content = "This is a note", JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(note);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenContentIsEmpty()
    {
        var note = new JournalNote { Content = string.Empty, JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(note);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "Content");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenContentIsWhitespace()
    {
        var note = new JournalNote { Content = "   ", JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(note);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "Content");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenContentExceedsMaxLength()
    {
        var note = new JournalNote { Content = new string('x', 2001), JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(note);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e =>
            e.PropertyName == "Content" &&
            e.ErrorMessage == "Content must not exceed 2000 characters.");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenContentIsExactly2000Characters()
    {
        var note = new JournalNote { Content = new string('x', 2000), JournalEntryId = 1 };

        var result = await _validator.ValidateAsync(note);

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }
}
