using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>
/// Resolves a goal given by id or title within one project's goals, with the same rules as <see cref="AreaResolver"/>.
/// Goal titles may repeat, so every error lists ids.
/// </summary>
internal static class GoalResolver
{
    public static GoalDto Resolve(IReadOnlyList<GoalDto> goals, string goal, string projectName)
    {
        var key = goal.Trim();

        if (int.TryParse(key, out var id) && goals.FirstOrDefault(g => g.Id == id) is { } byId)
        {
            return byId;
        }

        var exact = goals.Where(g => string.Equals(g.Title, key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (exact.Count == 1)
        {
            return exact[0];
        }

        var matches = exact.Count > 1
            ? exact
            : goals.Where(g => g.Title.Contains(key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (matches.Count == 1)
        {
            return matches[0];
        }

        if (matches.Count > 1)
        {
            throw ToolGuard.Invalid($"Goal '{goal}' is ambiguous in project '{projectName}' (matches {List(matches)}). Pass the goal id.");
        }

        throw ToolGuard.Invalid(goals.Count == 0
            ? $"No goal matches '{goal}': project '{projectName}' has no goals."
            : $"No goal matches '{goal}' in project '{projectName}'. Goals: {List(goals)}. Pass the goal id.");
    }

    public static string List(IEnumerable<GoalDto> goals) => string.Join(", ", goals.Select(Formatting.GoalLabel));
}
