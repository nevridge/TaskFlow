using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>Resolves a project given by name or id (as the model or user would naturally write it).</summary>
internal static class ProjectResolver
{
    public static async Task<ProjectDto> ResolveAsync(TaskFlowApiClient api, string project, CancellationToken ct) =>
        Resolve(await api.GetProjectsAsync(ct), project);

    public static ProjectDto Resolve(IReadOnlyList<ProjectDto> projects, string project)
    {
        var key = project.Trim();

        if (int.TryParse(key, out var id) && projects.FirstOrDefault(p => p.Id == id) is { } byId)
        {
            return byId;
        }

        var exact = projects.Where(p => string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (exact.Count == 1)
        {
            return exact[0];
        }

        var partial = projects.Where(p => p.Name.Contains(key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (partial.Count == 1)
        {
            return partial[0];
        }

        var available = projects.Count == 0
            ? "There are no projects yet - create one with save_project."
            : "Available projects: " + string.Join(", ", projects.Select(p => $"'{p.Name}' (#{p.Id})")) + ".";

        throw ToolGuard.Invalid(partial.Count > 1
            ? $"Project '{project}' is ambiguous (matches {string.Join(", ", partial.Select(p => $"'{p.Name}'"))}). Use the exact name or id."
            : $"No project matches '{project}'. {available}");
    }
}
