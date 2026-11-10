using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Integration.Tests.Infrastructure;

/// <summary>
/// One-way check that every field the client models expect shows up in at least one real API response of that
/// shape. The client records have no <c>required</c> members, so a renamed API field would otherwise deserialize
/// silently to a default. Extra JSON properties are never examined, and there is no allow-list.
/// </summary>
public static partial class FieldCoverage
{
    // Method + path (numeric segments as {id}, relative to /api/v1/) -> the client model the body maps to.
    private static readonly Dictionary<string, Type> Routes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["GET TaskItems"] = typeof(TaskItemDto),
        ["POST TaskItems"] = typeof(TaskItemDto),
        ["GET TaskItems/{id}"] = typeof(TaskItemDto),
        ["PUT TaskItems/{id}"] = typeof(TaskItemDto),
        ["GET JournalEntries/{id}/todos"] = typeof(TaskItemDto),
        ["GET JournalEntries"] = typeof(JournalEntryDto),
        ["POST JournalEntries"] = typeof(JournalEntryDto),
        ["PUT JournalEntries/{id}"] = typeof(JournalEntryDto),
        ["POST JournalEntries/{id}/logs"] = typeof(LogEntryDto),
        ["GET JournalEntries/{id}/notes"] = typeof(NoteDto),
        ["POST JournalEntries/{id}/notes"] = typeof(NoteDto),
        ["GET TaskItems/{id}/notes"] = typeof(NoteDto),
        ["POST TaskItems/{id}/notes"] = typeof(NoteDto),
    };

    private const string ApiPrefix = "/api/v1/";

    /// <summary>Camel-cased constructor parameter names of a model record (computed properties are not included).</summary>
    public static IReadOnlyList<string> ExpectedNames(Type model) =>
        [.. Parameters(model).Select(p => JsonNamingPolicy.CamelCase.ConvertName(p.Name!))];

    /// <summary>Returns the <c>Model.field</c> pairs never observed in the recorded successful responses.</summary>
    public static IReadOnlyList<string> FindMissing(IEnumerable<RecordedCall> calls)
    {
        var observed = new Dictionary<Type, List<JsonElement>>();
        var documents = new List<JsonDocument>();
        try
        {
            foreach (var call in calls)
            {
                if ((int)call.Status is < 200 or > 299 || string.IsNullOrWhiteSpace(call.Body))
                {
                    continue;
                }

                if (!Routes.TryGetValue($"{call.Method} {Normalize(call.Path)}", out var model))
                {
                    continue;
                }

                var doc = JsonDocument.Parse(call.Body);
                documents.Add(doc);
                Observe(model, doc.RootElement, observed);
            }

            var missing = new List<string>();
            foreach (var model in ModelsToCheck())
            {
                var objects = observed.GetValueOrDefault(model) ?? [];
                foreach (var name in ExpectedNames(model))
                {
                    if (!objects.Any(o => HasProperty(o, name)))
                    {
                        missing.Add($"{model.Name}.{name}");
                    }
                }
            }

            return missing;
        }
        finally
        {
            documents.ForEach(d => d.Dispose());
        }
    }

    private static string Normalize(string path)
    {
        var relative = path.StartsWith(ApiPrefix, StringComparison.OrdinalIgnoreCase) ? path[ApiPrefix.Length..] : path;
        return NumericSegment().Replace(relative.TrimEnd('/'), "{id}");
    }

    private static void Observe(Type model, JsonElement element, Dictionary<Type, List<JsonElement>> observed)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                Observe(model, item, observed);
            }

            return;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (!observed.TryGetValue(model, out var list))
        {
            observed[model] = list = [];
        }

        list.Add(element);

        foreach (var parameter in Parameters(model))
        {
            var nested = NestedModel(parameter.ParameterType);
            if (nested is null)
            {
                continue;
            }

            foreach (var property in element.EnumerateObject())
            {
                if (string.Equals(property.Name, parameter.Name, StringComparison.OrdinalIgnoreCase))
                {
                    Observe(nested, property.Value, observed);
                }
            }
        }
    }

    private static IEnumerable<Type> ModelsToCheck()
    {
        var result = new List<Type>();
        var pending = new Stack<Type>(Routes.Values.Distinct());
        while (pending.Count > 0)
        {
            var model = pending.Pop();
            if (result.Contains(model))
            {
                continue;
            }

            result.Add(model);
            foreach (var nested in Parameters(model).Select(p => NestedModel(p.ParameterType)).OfType<Type>())
            {
                pending.Push(nested);
            }
        }

        return result;
    }

    private static ParameterInfo[] Parameters(Type model) =>
        model.GetConstructors().Single().GetParameters();

    /// <summary>The record type behind a property (directly, or as the element of a list), or null for scalars.</summary>
    private static Type? NestedModel(Type type)
    {
        if (type.IsGenericType && type.GetGenericArguments() is [var element])
        {
            type = element;
        }

        return type.Namespace == typeof(TaskItemDto).Namespace && type.IsClass ? type : null;
    }

    private static bool HasProperty(JsonElement element, string name) =>
        element.EnumerateObject().Any(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));

    [GeneratedRegex(@"(?<=/|^)\d+(?=/|$)")]
    private static partial Regex NumericSegment();
}
