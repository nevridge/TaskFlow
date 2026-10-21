using TaskFlow.Api.Helpers;

namespace TaskFlow.Api.Tests.Helpers;

public class DaysTaggedHelperTests
{
    [Fact]
    public void GetDaysTagged_ShouldReturnPositiveCount_WhenBothDatesPresentAndCurrentIsAfterFirstTagged()
    {
        var firstTaggedDate = new DateOnly(2026, 5, 8);
        var currentJournalDate = new DateOnly(2026, 5, 10);

        var result = DaysTaggedHelper.GetDaysTagged(firstTaggedDate, currentJournalDate);

        Assert.Equal(3, result);
    }

    [Fact]
    public void GetDaysTagged_ShouldReturnZero_WhenFirstTaggedDateIsNull()
    {
        DateOnly? firstTaggedDate = null;
        var currentJournalDate = new DateOnly(2026, 5, 10);

        var result = DaysTaggedHelper.GetDaysTagged(firstTaggedDate, currentJournalDate);

        Assert.Equal(0, result);
    }

    [Fact]
    public void GetDaysTagged_ShouldReturnZero_WhenCurrentJournalDateIsNull()
    {
        var firstTaggedDate = new DateOnly(2026, 5, 8);
        DateOnly? currentJournalDate = null;

        var result = DaysTaggedHelper.GetDaysTagged(firstTaggedDate, currentJournalDate);

        Assert.Equal(0, result);
    }

    [Fact]
    public void GetDaysTagged_ShouldReturnZero_WhenBothDatesAreNull()
    {
        DateOnly? firstTaggedDate = null;
        DateOnly? currentJournalDate = null;

        var result = DaysTaggedHelper.GetDaysTagged(firstTaggedDate, currentJournalDate);

        Assert.Equal(0, result);
    }

    [Fact]
    public void GetDaysTagged_ShouldReturnOne_WhenBothDatesAreEqual()
    {
        var date = new DateOnly(2026, 5, 8);

        var result = DaysTaggedHelper.GetDaysTagged(date, date);

        Assert.Equal(1, result);
    }
}
