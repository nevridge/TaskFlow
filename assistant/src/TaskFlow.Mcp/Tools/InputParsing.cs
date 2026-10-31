using System.Globalization;

namespace TaskFlow.Mcp.Tools;

/// <summary>Parses and validates tool arguments, with error messages that tell the model how to fix the call.</summary>
internal static class InputParsing
{
    private static readonly string[] Priorities = ["low", "medium", "high"];
    private static readonly string[] Statuses = ["draft", "todo", "inprogress", "blocked", "completed"];

    /// <summary>The local calendar date.</summary>
    /// <remarks>Does its own clock read (one GetLocalNow). Use it only for read-only date resolution. Any call that also sends a UTC offset to the API must use <see cref="LocalNow"/> instead, so date and offset come from one snapshot.</remarks>
    public static DateOnly Today(TimeProvider time) => DateOnly.FromDateTime(time.GetLocalNow().DateTime);

    /// <summary>Local date and UTC offset from a single clock read, so the two can never straddle midnight or a DST change.</summary>
    public static (DateOnly Today, int OffsetMinutes) LocalNow(TimeProvider time)
    {
        var n = time.GetLocalNow();
        return (DateOnly.FromDateTime(n.DateTime), (int)n.Offset.TotalMinutes);
    }

    public static DateOnly ParseDate(string value, DateOnly today, string paramName)
    {
        switch (value.Trim().ToLowerInvariant())
        {
            case "today":
                return today;
            case "tomorrow":
                return today.AddDays(1);
            case "yesterday":
                return today.AddDays(-1);
        }

        if (TryParseIso(value, out var date))
        {
            return date;
        }

        throw ToolGuard.Invalid($"Invalid {paramName} '{value}'. Use yyyy-MM-dd, 'today', 'tomorrow' or 'yesterday'.");
    }

    /// <summary>
    /// Parses the journalDate of an update. Null or blank means "not supplied" (never an un-plan). Accepts today, tomorrow
    /// or yyyy-MM-dd; everything else, including yesterday, is rejected before any request. A past yyyy-MM-dd is left to the API.
    /// </summary>
    public static DateOnly? ParsePlanDay(string? value, DateOnly today, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        switch (value.Trim().ToLowerInvariant())
        {
            case "today":
                return today;
            case "tomorrow":
                return today.AddDays(1);
        }

        if (TryParseIso(value, out var date))
        {
            return date;
        }

        throw ToolGuard.Invalid(
            $"{paramName} '{value}' is not valid. Use today, tomorrow, or yyyy-MM-dd (today or later), e.g. {today.AddDays(1):yyyy-MM-dd}. "
            + "Planning cannot be removed via update; use set_journal_todos.");
    }

    private static bool TryParseIso(string value, out DateOnly date) =>
        DateOnly.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    public static DateOnly ParseDateOrToday(string? value, DateOnly today, string paramName) =>
        string.IsNullOrWhiteSpace(value) ? today : ParseDate(value, today, paramName);

    public static string NormalizePriority(string value) => Normalize(value, Priorities, "priority");

    public static string NormalizeStatus(string value) => Normalize(value, Statuses, "status");

    public static int Clamp(int value, int min, int max) => Math.Min(Math.Max(value, min), max);

    private static string Normalize(string value, string[] allowed, string name)
    {
        var normalized = value.Trim().ToLowerInvariant();
        return allowed.Contains(normalized)
            ? normalized
            : throw ToolGuard.Invalid($"Invalid {name} '{value}'. Allowed values: {string.Join(", ", allowed)}.");
    }
}
