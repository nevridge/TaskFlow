using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace TaskFlow.Api.Extensions;

public static class UtcDateTimeModelBuilderExtensions
{
    private static readonly HashSet<string> AuditPropertyNames = ["CreatedAt", "UpdatedAt", "OccurredAtUtc", "BlockedAt", "StartedAt"];

    /// <summary>
    /// Writes values unchanged and marks values read from the database as <see cref="DateTimeKind.Utc"/>,
    /// so System.Text.Json emits a Z suffix. Does not alter the stored text or the model snapshot.
    /// </summary>
    internal static ValueConverter<DateTime, DateTime> UtcConverter { get; } =
        new(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    /// <summary>
    /// Applies the UTC converter to audit timestamp properties (CreatedAt, UpdatedAt, OccurredAtUtc, BlockedAt, StartedAt) only.
    /// Other DateTime properties (e.g. TaskItem.DueDate) are intentionally left untouched.
    /// </summary>
    public static ModelBuilder ApplyUtcAuditTimestamps(this ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                if (AuditPropertyNames.Contains(property.Name)
                    && (property.ClrType == typeof(DateTime) || property.ClrType == typeof(DateTime?)))
                {
                    property.SetValueConverter(UtcConverter);
                }
            }
        }

        return modelBuilder;
    }
}
