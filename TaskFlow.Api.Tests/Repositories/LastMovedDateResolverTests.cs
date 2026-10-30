using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class LastMovedDateResolverTests
{
    private static readonly DateTime T0 = new(2026, 3, 1, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Resolve_NoEvents_ReturnsNull() =>
        Assert.Null(LastMovedDateResolver.Resolve([]));

    [Fact]
    public void Resolve_EventsWithoutDates_ReturnsNull() =>
        Assert.Null(LastMovedDateResolver.Resolve([new MoveEventProjection(1, T0, null, null)]));

    [Fact]
    public void Resolve_ToAndFromSet_ReturnsTo() =>
        Assert.Equal(new DateOnly(2026, 3, 2),
            LastMovedDateResolver.Resolve([new MoveEventProjection(1, T0, new DateOnly(2026, 3, 1), new DateOnly(2026, 3, 2))]));

    [Fact]
    public void Resolve_OnlyFromSet_ReturnsFrom() =>
        Assert.Equal(new DateOnly(2026, 3, 1),
            LastMovedDateResolver.Resolve([new MoveEventProjection(1, T0, new DateOnly(2026, 3, 1), null)]));

    [Fact]
    public void Resolve_MultipleEvents_ReturnsLatest() =>
        Assert.Equal(new DateOnly(2026, 3, 5),
            LastMovedDateResolver.Resolve(
            [
                new MoveEventProjection(1, T0, null, new DateOnly(2026, 3, 2)),
                new MoveEventProjection(2, T0.AddHours(2), null, new DateOnly(2026, 3, 5)),
                new MoveEventProjection(3, T0.AddHours(1), null, new DateOnly(2026, 3, 3))
            ]));

    [Fact]
    public void Resolve_NewestEventUndated_SkipsIt() =>
        Assert.Equal(new DateOnly(2026, 3, 2),
            LastMovedDateResolver.Resolve(
            [
                new MoveEventProjection(1, T0, null, new DateOnly(2026, 3, 2)),
                new MoveEventProjection(2, T0.AddHours(3), null, null)
            ]));

    [Fact]
    public void Resolve_TiedOccurredAt_LowerIdWins() =>
        Assert.Equal(new DateOnly(2026, 3, 2),
            LastMovedDateResolver.Resolve(
            [
                new MoveEventProjection(7, T0, null, new DateOnly(2026, 3, 9)),
                new MoveEventProjection(3, T0, null, new DateOnly(2026, 3, 2))
            ]));
}
