using System.Reflection;
using System.Text.RegularExpressions;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Tests;

public partial class ErrorCodeLiteralTests
{
    [GeneratedRegex("\"TASK_[A-Z0-9_]+")]
    private static partial Regex TaskCodeLiteral();

    private static IEnumerable<string> CodeValues() =>
        typeof(ErrorCodes)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && !f.IsInitOnly && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!);

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "TaskFlow.sln")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("TaskFlow.sln not found above " + AppContext.BaseDirectory);
    }

    [Fact]
    public void NoTaskCodeLiteralsOutsideContracts()
    {
        var root = FindRepoRoot();
        var apiDir = Path.Combine(root, "TaskFlow.Api");
        var skipped = new[] { "bin", "obj", "Migrations" };
        var offenders = new List<string>();

        foreach (var file in Directory.EnumerateFiles(apiDir, "*.cs", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(root, file);
            var segments = Path.GetRelativePath(apiDir, file).Split(Path.DirectorySeparatorChar);
            if (segments.Any(s => skipped.Contains(s)))
            {
                continue;
            }

            var lines = File.ReadAllLines(file);
            for (var i = 0; i < lines.Length; i++)
            {
                foreach (Match m in TaskCodeLiteral().Matches(lines[i]))
                {
                    offenders.Add(relative.Replace('\\', '/') + ":" + (i + 1) + " " + m.Value + "\"");
                }
            }
        }

        Assert.True(offenders.Count == 0,
            "Use ErrorCodes.X from TaskFlow.Contracts instead of TASK_ literals:\n" + string.Join("\n", offenders));
    }

    [Fact]
    public void ErrorCodes_AreDistinctTaskPrefixedUpperSnake()
    {
        var values = CodeValues().ToList();

        Assert.NotEmpty(values);
        Assert.Equal(values.Count, values.Distinct().Count());
        Assert.All(values, v =>
        {
            Assert.StartsWith("TASK_", v);
            Assert.Matches("^[A-Z_]+$", v);
        });
    }

    [Fact]
    public void ErrorCodes_ContainsEveryCurrentCode()
    {
        // Wire values are a contract with the web client and MCP; a rename here is a breaking change.
        var values = CodeValues().ToHashSet();

        Assert.Contains("TASK_START_NOT_ALLOWED", values);
        Assert.Contains("TASK_PLAN_HAS_OPEN_SUBTASKS", values);
        Assert.Contains("TASK_JOURNAL_ASSIGNMENT_CONFLICT", values);
        Assert.Contains("TASK_ASSIGNMENT_PAST_DAY_NOT_ALLOWED", values);
    }
}
