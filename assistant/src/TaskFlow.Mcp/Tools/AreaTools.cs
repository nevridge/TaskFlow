using System.ComponentModel;
using System.Net;
using System.Text;
using ModelContextProtocol.Server;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

[McpServerToolType]
public sealed class AreaTools(TaskFlowApiClient api)
{
    [McpServerTool(Name = "list_areas", ReadOnly = true)]
    [Description("Lists areas, which group projects, in display order with each area's project count. Counts include archived projects (list_projects hides those by default). Call it before save_project with 'area' or before delete_area.")]
    public Task<string> ListAreas(CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var areas = await api.GetAreasAsync(ct);

            return areas.Count == 0
                ? "No areas yet. Create one with save_area."
                : $"{areas.Count} area(s):\n" + string.Join("\n", areas.Select(a => $"#{a.Id} {a.Name} - {a.ProjectCount} project(s), including archived"));
        });

    [McpServerTool(Name = "save_area", Idempotent = true)]
    [Description("Creates an area, or renames one. Areas group projects. Omit 'area' to create; pass 'area' (name or id) to rename it to 'name'. To put a project in an area, use save_project.")]
    public Task<string> SaveArea(
        [Description("Area name (max 100 characters): the new area's name, or the new name when renaming. Names are unique, case-insensitive.")] string name,
        [Description("Existing area to rename, by name or id. Omit to create a new area.")] string? area = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                throw ToolGuard.Invalid("Pass 'name': the new area's name, or the new name for the area given in 'area'.");
            }

            var existing = string.IsNullOrWhiteSpace(area) ? null : await AreaResolver.ResolveAsync(api, area, ct);

            try
            {
                if (existing is null)
                {
                    var created = await api.CreateAreaAsync(name.Trim(), ct);
                    return $"Created area: #{created.Id} {created.Name}";
                }

                var renamed = await api.UpdateAreaAsync(existing.Id, name.Trim(), ct);
                return $"Renamed area #{renamed.Id} from '{existing.Name}' to '{renamed.Name}'.";
            }
            catch (TaskFlowApiException ex) when (ex.Status == HttpStatusCode.Conflict)
            {
                throw ToolGuard.Invalid(ex.Message + "\nNothing was changed. That area name is already used; check list_areas and choose a different name.");
            }
        });

    [McpServerTool(Name = "delete_area", Destructive = true)]
    [Description("Deletes an area. An area with no projects is deleted immediately, even with confirmed=false and no choice, so confirmed=false is not a dry run. "
        + "For an area with projects (archived projects count), a call that lacks a choice or confirmed=true deletes nothing and returns the project list. "
        + "The three choices for where the projects go are mutually exclusive: moveToArea, newAreaName or leaveProjectsWithoutArea=true. "
        + "Set confirmed=true only after the user has seen that list and agreed. Projects and their tasks are not deleted.")]
    public Task<string> DeleteArea(
        [Description("Area to delete: its id or exact name (any casing). A partial name is not accepted.")] string area,
        [Description("Where the projects go: name or id of an existing area.")] string? moveToArea = null,
        [Description("Where the projects go: name for an area to create (max 100 characters).")] string? newAreaName = null,
        [Description("Set true to keep the projects with no area. Default false.")] bool leaveProjectsWithoutArea = false,
        [Description("Set true only after the user has seen the affected projects and agreed. An area with no projects is deleted even when false. Default false.")] bool confirmed = false,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (string.IsNullOrWhiteSpace(area))
            {
                throw ToolGuard.Invalid("Pass 'area': the exact name or id of the area to delete. Nothing was deleted.");
            }

            var areas = await api.GetAreasAsync(ct);
            var target = ResolveForDelete(areas, area);
            var projects = (await api.GetProjectsAsync(ct)).Where(p => p.AreaId == target.Id).ToList();
            var moveToKey = string.IsNullOrWhiteSpace(moveToArea) ? null : moveToArea.Trim();
            var newName = string.IsNullOrWhiteSpace(newAreaName) ? null : newAreaName.Trim();
            var label = Label(target);

            if (projects.Count == 0)
            {
                await DeleteAsync(target.Id, null, null, false, ct);

                var result = $"Deleted area {label}. It had no projects.";
                if (moveToKey is not null)
                {
                    result += " moveToArea was not used: there was nothing to move.";
                }

                if (newName is not null)
                {
                    result += " newAreaName was not used: no area was created.";
                }

                return result;
            }

            var choices = (moveToKey is null ? 0 : 1) + (newName is null ? 0 : 1) + (leaveProjectsWithoutArea ? 1 : 0);
            if (choices > 1)
            {
                throw ToolGuard.Invalid("Pass only one of moveToArea, newAreaName or leaveProjectsWithoutArea=true. Nothing was changed.");
            }

            var destination = moveToKey is null ? null : AreaResolver.Resolve(areas, moveToKey);
            if (destination?.Id == target.Id)
            {
                throw ToolGuard.Invalid($"moveToArea must be a different area from the one being deleted ({label}). Nothing was changed.");
            }

            if (choices == 0 || !confirmed)
            {
                return Preview(areas, label, projects, destination, newName, leaveProjectsWithoutArea);
            }

            await DeleteAsync(target.Id, destination?.Id, newName, leaveProjectsWithoutArea, ct);

            var outcome = destination is not null ? $"Moved to area {Label(destination)}"
                : newName is not null ? $"Moved to the new area '{newName}'"
                : "Now without an area";

            return $"Deleted area {label}. {outcome}, {projects.Count} project(s): {string.Join(", ", projects.Select(ProjectLabel))}";
        });

    /// <summary>
    /// An empty area is deleted on the first call, so the area to delete is never guessed from a partial name.
    /// </summary>
    private static AreaDto ResolveForDelete(IReadOnlyList<AreaDto> areas, string area)
    {
        var target = AreaResolver.Resolve(areas, area);
        var key = area.Trim();
        var isId = int.TryParse(key, out var id) && target.Id == id;

        return isId || string.Equals(target.Name, key, StringComparison.OrdinalIgnoreCase)
            ? target
            : throw ToolGuard.Invalid($"No area is named '{key}'. Did you mean {Label(target)}? delete_area needs the exact name or id. Nothing was deleted.");
    }

    /// <summary>
    /// The API's delete errors name its query parameters, so each one gets a line in this tool's parameter names.
    /// </summary>
    private async Task DeleteAsync(int id, int? moveToAreaId, string? newAreaName, bool noArea, CancellationToken ct)
    {
        try
        {
            await api.DeleteAreaAsync(id, moveToAreaId, newAreaName, noArea, ct);
        }
        catch (TaskFlowApiException ex) when (ex.Status is HttpStatusCode.Conflict or HttpStatusCode.BadRequest)
        {
            var conflict = ex.Status == HttpStatusCode.Conflict;
            var guidance = conflict && newAreaName is not null
                ? "Nothing was changed. That area name is already used: pass it as moveToArea, or choose a different newAreaName."
                : conflict && moveToAreaId is null && !noArea
                    ? "Nothing was changed. This area now has projects: call delete_area again to see them, then choose moveToArea, newAreaName or leaveProjectsWithoutArea=true."
                    : "Nothing was changed. Check the areas with list_areas, then call delete_area again with exactly one of moveToArea, newAreaName or leaveProjectsWithoutArea=true.";

            throw ToolGuard.Invalid(ex.Message + "\n" + guidance);
        }
    }

    private static string Preview(
        IReadOnlyList<AreaDto> areas,
        string label,
        IReadOnlyList<ProjectDto> projects,
        AreaDto? destination,
        string? newName,
        bool leaveProjectsWithoutArea)
    {
        var sb = new StringBuilder();
        sb.Append("Nothing was deleted. Area ").Append(label).Append(" has ").Append(projects.Count).Append(" project(s):\n");
        foreach (var project in projects)
        {
            sb.Append("  ").Append(ProjectLabel(project)).Append('\n');
        }

        sb.Append("Choose where they go (one of):\n")
            .Append("  moveToArea: an existing area\n")
            .Append("  newAreaName: a new area to create\n")
            .Append("  leaveProjectsWithoutArea=true: no area\n");

        if (destination is not null)
        {
            sb.Append("Requested: moveToArea ").Append(Label(destination)).Append('\n');
        }

        if (newName is not null)
        {
            sb.Append("Requested: newAreaName '").Append(newName).Append("'\n");
            if (areas.FirstOrDefault(a => string.Equals(a.Name.Trim(), newName, StringComparison.OrdinalIgnoreCase)) is { } taken)
            {
                sb.Append("That name is already taken by area ").Append(Label(taken)).Append(", so the delete would be refused.\n");
            }
        }

        if (leaveProjectsWithoutArea)
        {
            sb.Append("Requested: leaveProjectsWithoutArea=true\n");
        }

        sb.Append("Ask the user, then call delete_area again with one choice and confirmed=true.");
        return sb.ToString();
    }

    private static string Label(AreaDto area) => $"#{area.Id} '{area.Name}'";

    private static string ProjectLabel(ProjectDto p) => $"#{p.Id} {p.Name}{(p.IsArchived ? " (archived)" : string.Empty)}";
}
