using FluentAssertions;
using TaskFlow.Api.Helpers;

namespace TaskFlow.Api.Tests.Helpers;

public class UserDateHelperTests
{
    private static readonly DateTime LateUtc = new(2026, 10, 14, 2, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void GetUserToday_ShouldReturnPreviousDay_WhenOffsetIsBehindUtcAcrossMidnight()
    {
        UserDateHelper.GetUserToday(LateUtc, -300).Should().Be(new DateOnly(2026, 10, 13));
    }

    [Fact]
    public void GetUserToday_ShouldRollForward_WhenOffsetIsPlus840()
    {
        var utc = new DateTime(2026, 10, 13, 12, 0, 0, DateTimeKind.Utc);
        UserDateHelper.GetUserToday(utc, 840).Should().Be(new DateOnly(2026, 10, 14));
    }

    [Fact]
    public void GetUserToday_ShouldRollBack_WhenOffsetIsMinus720()
    {
        var utc = new DateTime(2026, 10, 13, 11, 0, 0, DateTimeKind.Utc);
        UserDateHelper.GetUserToday(utc, -720).Should().Be(new DateOnly(2026, 10, 12));
    }

    [Fact]
    public void GetUserToday_ShouldReturnUtcDate_WhenOffsetIsNull()
    {
        UserDateHelper.GetUserToday(LateUtc, null).Should().Be(new DateOnly(2026, 10, 14));
    }
}
