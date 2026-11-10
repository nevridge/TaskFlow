namespace TaskFlow.Mcp.Integration.Tests.Infrastructure;

/// <summary>
/// The API reads the real clock, so tests derive the user's "today" the same way a client would:
/// UTC now shifted by the client's offset (positive is east of UTC). Deliberately independent of the API's helper.
/// Call it immediately before the request that depends on it; a test straddling midnight can flake (accepted).
/// </summary>
public static class TestClock
{
    /// <summary>A constant, non-zero offset so UTC-versus-local mistakes show up.</summary>
    public const int OffsetMinutes = 540;

    public static DateOnly Today(int offsetMinutes = OffsetMinutes) =>
        DateOnly.FromDateTime(DateTime.UtcNow.AddMinutes(offsetMinutes));
}
