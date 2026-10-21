using TaskFlow.Api.Helpers;

namespace TaskFlow.Api.Tests.Helpers;

public class UserDateHelperTests
{
    private static readonly DateTime LateUtc = new(2026, 10, 14, 2, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void GetUserToday_ShouldReturnPreviousDay_WhenOffsetIsBehindUtcAcrossMidnight()
    {
        Assert.Equal(new DateOnly(2026, 10, 13), UserDateHelper.GetUserToday(LateUtc, -300));
    }

    [Fact]
    public void GetUserToday_ShouldReturnLocalEveningDate_ForUsCentralDaylightOffset()
    {
        // 02:00 UTC on 10-14 is 21:00 on 10-13 in CDT (-300)
        var result = UserDateHelper.GetUserToday(LateUtc, -300);

        Assert.Equal(new DateOnly(2026, 10, 13), result);
        Assert.NotEqual(DateOnly.FromDateTime(LateUtc), result);
    }

    [Fact]
    public void GetUserToday_ShouldReturnUtcDate_WhenOffsetIsZero()
    {
        Assert.Equal(new DateOnly(2026, 10, 14), UserDateHelper.GetUserToday(LateUtc, 0));
    }

    [Fact]
    public void GetUserToday_ShouldRollForward_WhenOffsetIsPlus840()
    {
        var utc = new DateTime(2026, 10, 13, 12, 0, 0, DateTimeKind.Utc);
        Assert.Equal(new DateOnly(2026, 10, 14), UserDateHelper.GetUserToday(utc, 840));
    }

    [Fact]
    public void GetUserToday_ShouldRollBack_WhenOffsetIsMinus720()
    {
        var utc = new DateTime(2026, 10, 13, 11, 0, 0, DateTimeKind.Utc);
        Assert.Equal(new DateOnly(2026, 10, 12), UserDateHelper.GetUserToday(utc, -720));
    }

    [Fact]
    public void GetUserToday_ShouldReturnUtcDate_WhenOffsetIsNull()
    {
        Assert.Equal(new DateOnly(2026, 10, 14), UserDateHelper.GetUserToday(LateUtc, null));
    }
}
