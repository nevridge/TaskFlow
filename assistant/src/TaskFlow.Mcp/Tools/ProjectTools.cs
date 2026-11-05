using System.ComponentModel;
using System.Text;
using ModelContextProtocol.Server;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

[McpServerToolType]
public sealed class ProjectTools(TaskFlowApiClient api, TimeProvider time)
{
    private const int SectionLimit = 10;
    private const int DueSoonDays = 7;

    [McpServerTool(Name = "list_projects", ReadOnly = true)]
    [Description("Lists work projects with their open/done task counts. Use this to see which projects exist before assigning tasks or when the user mentions a project by name.")]
    public Task<string> ListProjects(
        [Description("Include archived projects. Default false.")] bool includeArchived = false,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var projects = (await api.GetProjectsAsync(ct))
                .Where(p => includeArchived || !p.IsArchived)
                .ToList();

            return projects.Count == 0
                ? "No projects yet. Create one with save_project."
                : $"{projects.Count} project(s):\n" + string.Join("\n", projects.Select(Formatting.Project));
        });

    [McpServerTool(Name = "save_project", Idempotent = true)]
    [Description("Creates a project, or updates one (rename, change description, archive/unarchive). Omit 'project' to create; pass 'project' (name or id) to update. Only the fields you pass are changed.")]
    public Task<string> SaveProject(
        [Description("Existing project to update, by name or id. Omit to create a new project.")] string? project = null,
        [Description("Project name (max 100 characters). Required when creating; renames when updating. Names are unique, case-insensitive.")] string? name = null,
        [Description("Description (max 2000 characters). Pass an empty string to clear it.")] string? description = null,
        [Description("Set true to archive, false to unarchive. Only applies when updating.")] bool? archived = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (string.IsNullOrWhiteSpace(project))
            {
                if (string.IsNullOrWhiteSpace(name))
                {
                    throw ToolGuard.Invalid("To create a project, pass 'name'. To update one, pass 'project' (name or id).");
                }

                var created = await api.CreateProjectAsync(name.Trim(), NullIfEmpty(description), ct);
                return "Created project: " + Formatting.Project(created);
            }

            var existing = await ProjectResolver.ResolveAsync(api, project, ct);
            var updated = await api.UpdateProjectAsync(
                existing.Id,
                string.IsNullOrWhiteSpace(name) ? existing.Name : name.Trim(),
                description is null ? existing.Description : NullIfEmpty(description),
                archived ?? existing.IsArchived,
                ct);

            return "Updated project: " + Formatting.Project(updated);
        });

    [McpServerTool(Name = "project_status", ReadOnly = true)]
    [Description("Summarizes one project's health: open/done counts, overdue tasks, tasks due within 7 days, stalled tasks (moved 3+ times or tagged 7+ days) and the most urgent open tasks. Blocked tasks are listed in their own section. Use for status updates and project check-ins.")]
    public Task<string> ProjectStatus(
        [Description("Project name or id.")] string project,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var target = await ProjectResolver.ResolveAsync(api, project, ct);
            var today = InputParsing.Today(time);
            var tasks = (await api.GetTasksAsync(ct)).Where(t => t.ProjectId == target.Id).ToList();
            var open = tasks.Where(t => !t.IsDone).ToList();
            var blocked = Formatting.OrderByUrgency(open.Where(t => t.IsBlocked)).ToList();
            var nowUtc = time.GetUtcNow();

            var sb = new StringBuilder();
            sb.AppendLine($"Project {target.Name} (#{target.Id}){(target.IsArchived ? " [archived]" : string.Empty)}: {open.Count} open{Formatting.BlockedCountText(blocked.Count)} / {tasks.Count - open.Count} done");

            if (open.Count == 0)
            {
                sb.Append("No open tasks.");
                return sb.ToString().TrimEnd();
            }

            sb.AppendLine("Open by priority: " + string.Join(", ", new[] { "High", "Medium", "Low" }
                .Select(p => $"{p} {open.Count(t => string.Equals(t.Priority, p, StringComparison.OrdinalIgnoreCase))}")));

            AppendSection(sb, "Blocked", blocked, today, nowUtc);
            AppendSection(sb, "Overdue", Formatting.OrderByDue(open.Where(t => t.DueDate < today)), today, nowUtc);
            AppendSection(sb, $"Due in the next {DueSoonDays} days", Formatting.OrderByDue(open.Where(t => t.DueDate >= today && t.DueDate <= today.AddDays(DueSoonDays))), today, nowUtc);
            AppendSection(sb, "Stalled (moved 3+ times or tagged 7+ days)", Formatting.OrderByUrgency(open.Where(t => !t.IsBlocked && TaskTools.IsStale(t))), today, nowUtc);
            AppendSection(sb, "Most urgent open", Formatting.OrderByUrgency(open).Take(5), today, nowUtc);

            return sb.ToString().TrimEnd();
        });

    private static void AppendSection(StringBuilder sb, string title, IEnumerable<TaskItemDto> items, DateOnly today, DateTimeOffset nowUtc)
    {
        var list = items.ToList();
        if (list.Count == 0)
        {
            return;
        }

        sb.AppendLine($"{title} ({list.Count}):");
        foreach (var task in list.Take(SectionLimit))
        {
            sb.AppendLine("  " + Formatting.Task(task, today, nowUtc: nowUtc));
        }

        if (list.Count > SectionLimit)
        {
            sb.AppendLine($"  ... and {list.Count - SectionLimit} more");
        }
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
