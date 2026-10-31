namespace TaskFlow.Api.Validators;

/// <summary>The accepted client UTC offset range, shared so journal validators cannot drift apart.</summary>
internal static class TimezoneOffsetBounds
{
    public const int MinMinutes = -720;
    public const int MaxMinutes = 840;
    public const string Message = "TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).";
}
