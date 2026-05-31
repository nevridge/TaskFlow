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

    [Fact]
    public async Task Validate_ShouldPass_WhenTaskItemIdIsNull()
    {
        var log = new JournalLogEntry { Content = "Work done", JournalEntryId = 1, TaskItemId = null };

        var result = await _validator.ValidateAsync(log);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTaskItemIdIsPositive()
    {
        var log = new JournalLogEntry { Content = "Work done", JournalEntryId = 1, TaskItemId = 5 };

        var result = await _validator.ValidateAsync(log);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenTaskItemIdIsZero()
    {
        var log = new JournalLogEntry { Content = "Work done", JournalEntryId = 1, TaskItemId = 0 };

        var result = await _validator.ValidateAsync(log);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "TaskItemId");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenTaskItemIdIsNegative()
    {
        var log = new JournalLogEntry { Content = "Work done", JournalEntryId = 1, TaskItemId = -1 };

        var result = await _validator.ValidateAsync(log);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "TaskItemId");
    }
}
