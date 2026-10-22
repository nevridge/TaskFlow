using System.Globalization;

namespace TaskFlow.Mcp.Tools;

/// <summary>Parses and validates tool arguments, with error messages that tell the model how to fix the call.</summary>
internal static class InputParsing
{
    private static readonly string[] Priorities = ["low", "medium", "high"];
    private static readonly string[] Statuses = ["draft", "todo", "blocked", "completed"];

    public static DateOnly Today(TimeProvider time) => DateOnly.FromDateTime(time.GetLocalNow().DateTime);

    /// <summary>The local UTC offset in minutes, which the API uses for its "past day" rules.</summary>
    public static int OffsetMinutes(TimeProvider time) => (int)time.GetLocalNow().Offset.TotalMinutes;

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

        if (DateOnly.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return date;
        }

        throw ToolGuard.Invalid($"Invalid {paramName} '{value}'. Use yyyy-MM-dd, 'today', 'tomorrow' or 'yesterday'.");
    }

    public static DateOnly ParseDateOrToday(string? value, DateOnly today, string paramName) =>
        string.IsNullOrWhiteSpace(value) ? today : ParseDate(value, today, paramName);

    public static string NormalizePriority(string value) => Normalize(value, Priorities, "priority");

    public static string NormalizeStatus(string value) => Normalize(value, Statuses, "status");

    public static DateTime ToDueDateTime(DateOnly date) =>
        DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);

    public static int Clamp(int value, int min, int max) => Math.Min(Math.Max(value, min), max);

    private static string Normalize(string value, string[] allowed, string name)
    {
        var normalized = value.Trim().ToLowerInvariant();
        return allowed.Contains(normalized)
            ? normalized
            : throw ToolGuard.Invalid($"Invalid {name} '{value}'. Allowed values: {string.Join(", ", allowed)}.");
    }
}
