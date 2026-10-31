namespace TaskFlow.Api.Helpers;

public static class UserDateHelper
{
    /// <summary>
    /// Returns the user's local date. A null offset falls back to the UTC date (legacy behavior);
    /// the fallback is deliberate for the reopen guard in TaskItemsController.Update, while
    /// carry-forward callers must still check HasValue before calling. Journal day attribution of completed tasks
    /// (<see cref="JournalDayRule"/>) is the other deliberate UTC-fallback caller.
    /// </summary>
    public static DateOnly GetUserToday(DateTime utcNow, int? timezoneOffsetMinutes) =>
        GetUserDate(utcNow, timezoneOffsetMinutes);

    /// <summary>
    /// Returns the user's local calendar date for a UTC instant. A null offset falls back to the UTC date.
    /// </summary>
    public static DateOnly GetUserDate(DateTime utcInstant, int? offsetMinutes) =>
        DateOnly.FromDateTime(offsetMinutes.HasValue ? utcInstant.AddMinutes(offsetMinutes.Value) : utcInstant);
}
