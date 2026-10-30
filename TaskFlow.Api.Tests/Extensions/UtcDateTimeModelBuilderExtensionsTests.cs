using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design.Internal;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Extensions;
using TaskFlow.Api.Models;
using TaskFlow.Api.Providers;

namespace TaskFlow.Api.Tests.Extensions;

public class UtcDateTimeModelBuilderExtensionsTests
{
    // Fixed instant with sub-second ticks (7 fractional digits).
    private static readonly DateTime Instant = new(2026, 10, 12, 13, 40, 32, DateTimeKind.Utc);
    private static readonly DateTime InstantWithTicks = Instant.AddTicks(4115610);

    private static (SqliteConnection connection, DbContextOptions<TaskDbContext> options) CreateSqlite()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseSqlite(connection)
            .Options;
        using (var context = new TaskDbContext(options))
        {
            context.Database.EnsureCreated();
        }

        return (connection, options);
    }

    private static async Task<int> SeedJournalEntryAsync(TaskDbContext context)
    {
        var entry = new JournalEntry
        {
            Title = "Day",
            Date = new DateOnly(2026, 10, 12),
            CreatedAt = InstantWithTicks,
            UpdatedAt = InstantWithTicks.AddMinutes(1)
        };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();
        return entry.Id;
    }

    [Fact]
    public async Task AuditTimestamps_JournalEntry_RoundTripThroughSqlite_HaveUtcKindAndSameInstant()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            id = await SeedJournalEntryAsync(writer);
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == id);

        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.CreatedAt.Ticks);
        Assert.NotNull(loaded.UpdatedAt);
        Assert.Equal(DateTimeKind.Utc, loaded.UpdatedAt!.Value.Kind);
        Assert.Equal(InstantWithTicks.AddMinutes(1).Ticks, loaded.UpdatedAt.Value.Ticks);
    }

    [Fact]
    public async Task AuditTimestamps_JournalLogEntry_RoundTripThroughSqlite_HaveUtcKindAndSameInstant()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var entryId = await SeedJournalEntryAsync(writer);
            var log = new JournalLogEntry
            {
                Content = "log",
                JournalEntryId = entryId,
                CreatedAt = InstantWithTicks,
                UpdatedAt = InstantWithTicks.AddSeconds(5)
            };
            writer.JournalLogEntries.Add(log);
            await writer.SaveChangesAsync();
            id = log.Id;
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.JournalLogEntries.AsNoTracking().SingleAsync(e => e.Id == id);

        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.CreatedAt.Ticks);
        Assert.Equal(DateTimeKind.Utc, loaded.UpdatedAt!.Value.Kind);
        Assert.Equal(InstantWithTicks.AddSeconds(5).Ticks, loaded.UpdatedAt.Value.Ticks);
    }

    [Fact]
    public async Task AuditTimestamps_JournalNote_RoundTripThroughSqlite_HaveUtcKindAndSameInstant()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var entryId = await SeedJournalEntryAsync(writer);
            var note = new JournalNote
            {
                Content = "note",
                JournalEntryId = entryId,
                CreatedAt = InstantWithTicks,
                UpdatedAt = InstantWithTicks.AddSeconds(5)
            };
            writer.JournalNotes.Add(note);
            await writer.SaveChangesAsync();
            id = note.Id;
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.JournalNotes.AsNoTracking().SingleAsync(e => e.Id == id);

        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.CreatedAt.Ticks);
        Assert.Equal(DateTimeKind.Utc, loaded.UpdatedAt!.Value.Kind);
        Assert.Equal(InstantWithTicks.AddSeconds(5).Ticks, loaded.UpdatedAt.Value.Ticks);
    }

    [Fact]
    public async Task AuditTimestamps_Note_RoundTripThroughSqlite_HaveUtcKindAndSameInstant()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var task = new TaskItem { Title = "t" };
            writer.TaskItems.Add(task);
            await writer.SaveChangesAsync();
            var note = new Note
            {
                Content = "note",
                TaskItemId = task.Id,
                CreatedAt = InstantWithTicks,
                UpdatedAt = InstantWithTicks.AddSeconds(5)
            };
            writer.Notes.Add(note);
            await writer.SaveChangesAsync();
            id = note.Id;
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.Notes.AsNoTracking().SingleAsync(e => e.Id == id);

        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.CreatedAt.Ticks);
        Assert.Equal(DateTimeKind.Utc, loaded.UpdatedAt!.Value.Kind);
        Assert.Equal(InstantWithTicks.AddSeconds(5).Ticks, loaded.UpdatedAt.Value.Ticks);
    }

    [Fact]
    public async Task AuditTimestamps_Project_RoundTripThroughSqlite_HaveUtcKindAndSameInstant()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var project = new Project
            {
                Name = "P",
                CreatedAt = InstantWithTicks,
                UpdatedAt = InstantWithTicks.AddSeconds(5)
            };
            writer.Projects.Add(project);
            await writer.SaveChangesAsync();
            id = project.Id;
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.Projects.AsNoTracking().SingleAsync(e => e.Id == id);

        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.CreatedAt.Ticks);
        Assert.Equal(DateTimeKind.Utc, loaded.UpdatedAt!.Value.Kind);
        Assert.Equal(InstantWithTicks.AddSeconds(5).Ticks, loaded.UpdatedAt.Value.Ticks);
    }

    [Fact]
    public async Task AuditTimestamps_TaskItemEvent_RoundTripThroughSqlite_HaveUtcKindAndSameInstant()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var task = new TaskItem { Title = "t" };
            writer.TaskItems.Add(task);
            await writer.SaveChangesAsync();
            var evt = new TaskItemEvent
            {
                TaskItemId = task.Id,
                EventType = "Created",
                OccurredAtUtc = InstantWithTicks
            };
            writer.TaskItemEvents.Add(evt);
            await writer.SaveChangesAsync();
            id = evt.Id;
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.TaskItemEvents.AsNoTracking().SingleAsync(e => e.Id == id);

        Assert.Equal(DateTimeKind.Utc, loaded.OccurredAtUtc.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.OccurredAtUtc.Ticks);
    }

    [Fact]
    public async Task UpdatedAt_Null_RemainsNull_AfterRoundTrip()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var project = new Project { Name = "P", CreatedAt = InstantWithTicks };
            writer.Projects.Add(project);
            await writer.SaveChangesAsync();
            id = project.Id;
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.Projects.AsNoTracking().SingleAsync(e => e.Id == id);

        Assert.Null(loaded.UpdatedAt);
        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
    }

    [Fact]
    public async Task ApiJson_SerializedAuditTimestamp_EndsWithZ()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            id = await SeedJournalEntryAsync(writer);
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == id);

        var dto = new JournalEntryResponseDto
        {
            Id = loaded.Id,
            Title = loaded.Title,
            CreatedAt = loaded.CreatedAt,
            UpdatedAt = loaded.UpdatedAt
        };
        var json = JsonSerializer.Serialize(dto, JsonSerializerOptionsProvider.Default);
        using var doc = JsonDocument.Parse(json);

        Assert.EndsWith("Z", doc.RootElement.GetProperty("createdAt").GetString(), StringComparison.Ordinal);
        Assert.EndsWith("Z", doc.RootElement.GetProperty("updatedAt").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task StoredText_IsUnchanged_ByConverter()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        await using (var writer = new TaskDbContext(options))
        {
            await SeedJournalEntryAsync(writer);
        }

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT CreatedAt FROM JournalEntries";
        var stored = (string?)await command.ExecuteScalarAsync();

        Assert.Equal(InstantWithTicks.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF"), stored);
    }

    [Fact]
    public async Task RoundTrip_WithoutConverter_WouldBeUnspecified()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var entryId = await SeedJournalEntryAsync(writer);
            var note = new JournalNote { Content = "n", JournalEntryId = entryId, CreatedAt = InstantWithTicks };
            writer.JournalNotes.Add(note);
            await writer.SaveChangesAsync();
            id = note.Id;
        }

        var plainOptions = new DbContextOptionsBuilder<PlainContext>().UseSqlite(connection).Options;
        await using var plain = new PlainContext(plainOptions);
        var loaded = await plain.Notes.AsNoTracking().SingleAsync(n => n.Id == id);

        Assert.Equal(DateTimeKind.Unspecified, loaded.CreatedAt.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.CreatedAt.Ticks);
    }

    [Fact]
    public async Task TaskItem_DueDate_RoundTrip_StoresCalendarDateText()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        var due = new DateOnly(2026, 12, 25);
        int withDueId;
        int withoutDueId;
        await using (var writer = new TaskDbContext(options))
        {
            var withDue = new TaskItem { Title = "a", DueDate = due };
            var withoutDue = new TaskItem { Title = "b" };
            writer.TaskItems.AddRange(withDue, withoutDue);
            await writer.SaveChangesAsync();
            withDueId = withDue.Id;
            withoutDueId = withoutDue.Id;
        }

        await using var reader = new TaskDbContext(options);
        var a = await reader.TaskItems.AsNoTracking().SingleAsync(t => t.Id == withDueId);
        var b = await reader.TaskItems.AsNoTracking().SingleAsync(t => t.Id == withoutDueId);

        Assert.Equal(due, a.DueDate);
        Assert.Null(b.DueDate);

        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT DueDate FROM TaskItems WHERE Id = {withDueId}";
        Assert.Equal("2026-12-25", (string?)await command.ExecuteScalarAsync());
        command.CommandText = $"SELECT DueDate FROM TaskItems WHERE Id = {withoutDueId}";
        Assert.Equal(DBNull.Value, await command.ExecuteScalarAsync());
    }

    [Fact]
    public async Task BlockedAt_TaskItem_RoundTripsThroughSqlite_HasUtcKindAndSerializesWithZ()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var task = new TaskItem
            {
                Title = "Blocked",
                Status = Status.Blocked,
                BlockedAt = InstantWithTicks,
                PreviousStatus = Status.Todo
            };
            writer.TaskItems.Add(task);
            await writer.SaveChangesAsync();
            id = task.Id;
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);

        Assert.NotNull(loaded.BlockedAt);
        Assert.Equal(DateTimeKind.Utc, loaded.BlockedAt!.Value.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.BlockedAt.Value.Ticks);
        Assert.Equal(Status.Todo, loaded.PreviousStatus);
        Assert.EndsWith("Z\"", JsonSerializer.Serialize(loaded.BlockedAt));
    }

    [Fact]
    public async Task StartedAt_TaskItem_RoundTripsThroughSqlite_HasUtcKindAndSerializesWithZ()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        int id;
        await using (var writer = new TaskDbContext(options))
        {
            var task = new TaskItem { Title = "Started", Status = Status.InProgress, StartedAt = InstantWithTicks };
            writer.TaskItems.Add(task);
            await writer.SaveChangesAsync();
            id = task.Id;
        }

        await using var reader = new TaskDbContext(options);
        var loaded = await reader.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);

        Assert.Equal(Status.InProgress, loaded.Status);
        Assert.NotNull(loaded.StartedAt);
        Assert.Equal(DateTimeKind.Utc, loaded.StartedAt!.Value.Kind);
        Assert.Equal(InstantWithTicks.Ticks, loaded.StartedAt.Value.Ticks);
        Assert.EndsWith("Z\"", JsonSerializer.Serialize(loaded.StartedAt));
    }

    [Fact]
    public void AllDateTimeProperties_InModel_AreEitherUtcConvertedOrAllowlisted()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        using var context = new TaskDbContext(options);

        // TaskItem.DueDate is a DateOnly? calendar date (not DateTime), so it is neither converted nor allowlisted.
        var allowlist = new HashSet<string>();
        var dueDate = context.Model.FindEntityType(typeof(TaskItem))!.FindProperty(nameof(TaskItem.DueDate))!;
        Assert.Equal(typeof(DateOnly?), dueDate.ClrType);
        Assert.False(ReferenceEquals(dueDate.GetValueConverter(), UtcDateTimeModelBuilderExtensions.UtcConverter));

        foreach (var entityType in context.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                if (property.ClrType != typeof(DateTime) && property.ClrType != typeof(DateTime?))
                {
                    continue;
                }

                var name = $"{entityType.ClrType.Name}.{property.Name}";
                var isConverted = ReferenceEquals(property.GetValueConverter(), UtcDateTimeModelBuilderExtensions.UtcConverter);
                Assert.True(isConverted || allowlist.Contains(name), $"New DateTime property {name}: apply UTC converter or add to allowlist.");
                if (allowlist.Contains(name))
                {
                    Assert.Null(property.GetValueConverter());
                }
            }
        }
    }

    [Fact]
    public void ModelSnapshot_HasNoPendingChanges()
    {
        var (connection, options) = CreateSqlite();
        using var _ = connection;
        using var context = new TaskDbContext(options);

        var snapshotModel = context.GetService<IMigrationsAssembly>().ModelSnapshot?.Model;
        Assert.NotNull(snapshotModel);

        var finalized = context.GetService<IModelRuntimeInitializer>()
            .Initialize(((IMutableModel)snapshotModel!).FinalizeModel());
        var differ = context.GetService<IMigrationsModelDiffer>();
        var designModel = context.GetService<IDesignTimeModel>().Model;

        Assert.False(differ.HasDifferences(finalized.GetRelationalModel(), designModel.GetRelationalModel()), "the UTC converter must not change the schema or model snapshot");
    }

    private sealed class PlainContext(DbContextOptions<PlainContext> options) : DbContext(options)
    {
        public DbSet<JournalNote> Notes => Set<JournalNote>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // Ignore the navigation targets of JournalNote so the model contains only the note table,
            // mapped without the UTC converter.
            modelBuilder.Ignore<JournalEntry>();
            modelBuilder.Ignore<TaskItem>();
            modelBuilder.Entity<JournalNote>().ToTable("JournalNotes");
        }
    }
}
