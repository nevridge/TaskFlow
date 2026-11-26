using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class AppendJournalSummaryDtoValidatorTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  \t\n")]
    public async Task Validate_ShouldFail_WhenTextIsBlank(string? text)
    {
        var result = await new AppendJournalSummaryDtoValidator().ValidateAsync(new AppendJournalSummaryDto { Text = text! });

        Assert.False(result.IsValid);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTextHasContent()
    {
        var result = await new AppendJournalSummaryDtoValidator().ValidateAsync(new AppendJournalSummaryDto { Text = "note" });

        Assert.True(result.IsValid);
    }

    // The append limit is a separate constant from the stored-summary rule; if they drift, an append could store a
    // summary that a later PUT refuses (or refuse one the PUT accepts).
    [Fact]
    public async Task MaxSummaryLength_EqualsTheLimitJournalEntryValidatorEnforces()
    {
        var validator = new JournalEntryValidator();
        var date = new DateOnly(2026, 5, 10);
        var atLimit = new JournalEntry { Title = "Entry", Date = date, Summary = new string('a', AppendJournalSummaryDtoValidator.MaxSummaryLength) };
        var overLimit = new JournalEntry { Title = "Entry", Date = date, Summary = new string('a', AppendJournalSummaryDtoValidator.MaxSummaryLength + 1) };

        Assert.True((await validator.ValidateAsync(atLimit)).IsValid);
        Assert.False((await validator.ValidateAsync(overLimit)).IsValid);
    }
}
