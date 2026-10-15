namespace TaskFlow.Api.Helpers;

public static class UserDateHelper
{
    /// <summary>
    /// Returns the user's local date. A null offset falls back to the UTC date (legacy behavior);
    /// the fallback is deliberate for the reopen guard in TaskItemsController.Update, while
    /// carry-forward callers must still check HasValue before calling.
    /// </summary>
    public static DateOnly GetUserToday(DateTime utcNow, int? timezoneOffsetMinutes) =>
        DateOnly.FromDateTime(timezoneOffsetMinutes.HasValue ? utcNow.AddMinutes(timezoneOffsetMinutes.Value) : utcNow);
}
