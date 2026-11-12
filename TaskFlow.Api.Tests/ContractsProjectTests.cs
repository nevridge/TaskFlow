using TaskFlow.Contracts;

namespace TaskFlow.Api.Tests;

public class ContractsProjectTests
{
    [Fact]
    public void ContractsAssembly_HasNoEfCoreOrAspNetReferences()
    {
        var referenced = typeof(ErrorCodes).Assembly.GetReferencedAssemblies()
            .Select(a => a.Name ?? string.Empty)
            .ToList();

        Assert.DoesNotContain(referenced, n => n.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal));
        Assert.DoesNotContain(referenced, n => n.StartsWith("Microsoft.AspNetCore", StringComparison.Ordinal));
        Assert.DoesNotContain(referenced, n => n.StartsWith("Microsoft.Extensions", StringComparison.Ordinal));
    }

    [Fact]
    public void ErrorCodes_AreDefinedAsConstStrings_NotAnEnum()
    {
        Assert.True(typeof(ErrorCodes).IsAbstract && typeof(ErrorCodes).IsSealed, "ErrorCodes must be a static class");
        Assert.Equal(19, typeof(ErrorCodes).GetFields().Count(f => f.IsLiteral && f.FieldType == typeof(string)));
    }

    [Fact]
    public void StatusAndPriority_KeepTheirStoredIntValues()
    {
        // EF stores these as int; renumbering would corrupt existing rows without a migration.
        Assert.Equal(0, (int)Status.Draft);
        Assert.Equal(1, (int)Status.Todo);
        Assert.Equal(2, (int)Status.Completed);
        Assert.Equal(3, (int)Status.Blocked);
        Assert.Equal(4, (int)Status.InProgress);
        Assert.Equal(0, (int)Priority.Low);
        Assert.Equal(1, (int)Priority.Medium);
        Assert.Equal(2, (int)Priority.High);
        Assert.Equal(5, Enum.GetValues<Status>().Length);
        Assert.Equal(3, Enum.GetValues<Priority>().Length);
    }
}
