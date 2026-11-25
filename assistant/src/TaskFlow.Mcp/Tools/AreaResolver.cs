using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>Resolves an area given by name or id, with the same rules as <see cref="ProjectResolver"/>.</summary>
internal static class AreaResolver
{
    public static async Task<AreaDto> ResolveAsync(TaskFlowApiClient api, string area, CancellationToken ct) =>
        Resolve(await api.GetAreasAsync(ct), area);

    public static AreaDto Resolve(IReadOnlyList<AreaDto> areas, string area)
    {
        var key = area.Trim();

        if (int.TryParse(key, out var id) && areas.FirstOrDefault(a => a.Id == id) is { } byId)
        {
            return byId;
        }

        var exact = areas.Where(a => string.Equals(a.Name, key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (exact.Count == 1)
        {
            return exact[0];
        }

        var partial = areas.Where(a => a.Name.Contains(key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (partial.Count == 1)
        {
            return partial[0];
        }

        var available = areas.Count == 0
            ? "There are no areas yet - create one with save_area."
            : "Available areas: " + string.Join(", ", areas.Select(a => $"'{a.Name}' (#{a.Id})")) + ".";

        throw ToolGuard.Invalid(partial.Count > 1
            ? $"Area '{area}' is ambiguous (matches {string.Join(", ", partial.Select(a => $"'{a.Name}'"))}). Use the exact name or id."
            : $"No area matches '{area}'. {available}");
    }
}
