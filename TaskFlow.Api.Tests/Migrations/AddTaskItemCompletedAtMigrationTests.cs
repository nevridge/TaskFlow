#nullable enable

using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;

namespace TaskFlow.Api.Tests.Migrations;

/// <summary>
/// Runs the real migration chain against real in-memory SQLite to prove the additive Up, the legacy
/// CompletedAt backfill from TaskItemEvents (both timestamp text formats) and the Down of <c>AddTaskItemCompletedAt</c>.
/// </summary>
public class AddTaskItemCompletedAtMigrationTests : IDisposable
{
    private const string PreviousMigration = "20261030234403_ConvertTaskItemDueDateToDateOnly";
    private const string TargetMigration = "20261031024516_AddTaskItemCompletedAt";

    private const int Todo = 1;
    private const int Completed = 2;

    private const string SyntheticSummary = "Marked complete by a data migration that merged the legacy flag.";

    private readonly SqliteConnection _connection;
    private readonly TaskDbContext _context;

    public AddTaskItemCompletedAtMigrationTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _context = new TaskDbContext(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options);
    }

    public void Dispose()
    {
        _context.Dispose();
        _connection.Dispose();
    }

    private void MigrateTo(string migration) => _context.GetService<IMigrator>().Migrate(migration);

    private void Exec(string sql)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private long Count(string sql)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(command.ExecuteScalar()!);
    }

    private bool HasColumn(string name) =>
        Count($"SELECT COUNT(*) FROM pragma_table_info('TaskItems') WHERE name = '{name}'") > 0;

    private string? CompletedAtOf(int id)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = $"SELECT \"CompletedAt\" FROM \"TaskItems\" WHERE \"Id\" = {id}";
        var value = command.ExecuteScalar();
        return value is null or DBNull ? null : (string)value;
    }

    private void InsertTask(int id, int status) =>
        Exec($"INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"Status\", \"Priority\", \"MoveCount\") VALUES ({id}, 'Task {id}', {status}, 1, 0)");

    private void InsertEvent(int taskId, string type, string occurredAt, string? summary = null)
    {
        var summarySql = summary is null ? "NULL" : $"'{summary}'";
        Exec("INSERT INTO \"TaskItemEvents\" (\"TaskItemId\", \"EventType\", \"OccurredAtUtc\", \"ChangeSummary\") " +
             $"VALUES ({taskId}, '{type}', '{occurredAt}', {summarySql})");
    }

    [Fact]
    public void Up_ShouldAddNullableCompletedAtColumn()
    {
        MigrateTo(PreviousMigration);
        Assert.False(HasColumn("CompletedAt"));

        MigrateTo(TargetMigration);

        Assert.True(HasColumn("CompletedAt"));
        Assert.Equal(1L, Count("SELECT COUNT(*) FROM pragma_table_info('TaskItems') WHERE name = 'CompletedAt' AND \"notnull\" = 0"));
    }

    [Fact]
    public void Up_ShouldUseLatestCompletedEvent_WhenCompletedReopenedCompletedAgain()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        InsertEvent(1, "Completed", "2026-06-01 10:00:00.0000000");
        InsertEvent(1, "Reopened", "2026-06-02 10:00:00.0000000");
        InsertEvent(1, "Completed", "2026-06-03 10:00:00.0000000");

        MigrateTo(TargetMigration);

        Assert.Equal("2026-06-03 10:00:00.0000000", CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldLeaveNull_WhenLatestReopenedIsAfterLatestCompleted()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        InsertEvent(1, "Completed", "2026-06-01 10:00:00.0000000");
        InsertEvent(1, "Reopened", "2026-06-02 10:00:00.0000000");

        MigrateTo(TargetMigration);

        Assert.Null(CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldLeaveNull_WhenCompletedAndReopenedHaveEqualTimestamps()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        InsertEvent(1, "Completed", "2026-06-02 10:00:00.0000000");
        InsertEvent(1, "Reopened", "2026-06-02 10:00:00.0000000");

        MigrateTo(TargetMigration);

        Assert.Null(CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldLeaveNull_WhenOnlySyntheticCompletedEventExists()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        InsertEvent(1, "Completed", "2026-10-22 14:12:48.123", SyntheticSummary);

        MigrateTo(TargetMigration);

        Assert.Null(CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldPreferGenuineEvent_WhenSyntheticEventIsLater()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        InsertEvent(1, "Completed", "2026-06-03 10:00:00.0000000", "Marked complete.");
        InsertEvent(1, "Completed", "2026-10-22 14:12:48.123", SyntheticSummary);

        MigrateTo(TargetMigration);

        Assert.Equal("2026-06-03 10:00:00.0000000", CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldLeaveNull_WhenCompletedTaskHasNoEvents_AndNotUseLinkedDay()
    {
        MigrateTo(PreviousMigration);
        Exec("INSERT INTO \"JournalEntries\" (\"Id\", \"Title\", \"Date\", \"CreatedAt\") VALUES (1, 'J', '2026-05-01', '2026-05-01 00:00:00')");
        InsertTask(1, Completed);
        Exec("UPDATE \"TaskItems\" SET \"CurrentJournalEntryId\" = 1 WHERE \"Id\" = 1");
        InsertEvent(1, "TaskCreated", "2026-01-01 00:00:00.0000000", "Task was created.");

        MigrateTo(TargetMigration);

        Assert.Null(CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldOrderMixedFormatsByInstant()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        InsertEvent(1, "Completed", "2026-06-03 10:00:00.4990000", "Marked complete.");
        InsertEvent(1, "Completed", "2026-06-03 10:00:00.500", "Marked complete.");

        MigrateTo(TargetMigration);

        Assert.Equal("2026-06-03 10:00:00.500", CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldReopenCompare_AcrossMixedFormats()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        // Reopened (7 digits) is 1 ms BEFORE the Completed (3 digits); SQLite julianday resolves milliseconds.
        InsertEvent(1, "Reopened", "2026-06-03 10:00:00.4990000");
        InsertEvent(1, "Completed", "2026-06-03 10:00:00.500", "Marked complete.");

        MigrateTo(TargetMigration);

        Assert.Equal("2026-06-03 10:00:00.500", CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldTreatEqualInstantsInDifferentFormatsAsEqual_NotByStringComparison()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        // Same instant. As text, "...00.4990000" sorts AFTER "...00.499", so a string comparison would wrongly
        // treat the Completed event as later than the Reopened one. As instants they are equal: strict > gives null.
        InsertEvent(1, "Reopened", "2026-06-03 10:00:00.499");
        InsertEvent(1, "Completed", "2026-06-03 10:00:00.4990000", "Marked complete.");

        MigrateTo(TargetMigration);

        Assert.Null(CompletedAtOf(1));
    }

    [Fact]
    public void Up_ShouldCopyOriginalTextVerbatim_AndEfCanReadIt()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Completed);
        InsertEvent(1, "Completed", "2026-06-03 10:00:00.1234567", "Marked complete.");

        MigrateTo(TargetMigration);

        Assert.Equal("2026-06-03 10:00:00.1234567", CompletedAtOf(1));
        using var verify = new TaskDbContext(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options);
        var task = verify.TaskItems.AsNoTracking().Single(t => t.Id == 1);
        Assert.Equal(new DateTime(2026, 6, 3, 10, 0, 0, DateTimeKind.Utc).AddTicks(1234567), task.CompletedAt);
        Assert.Equal(DateTimeKind.Utc, task.CompletedAt!.Value.Kind);
    }

    [Fact]
    public void Up_ShouldLeaveNonCompletedTasksNull_EvenWithCompletedEvents()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Todo);
        InsertEvent(1, "Completed", "2026-06-03 10:00:00.0000000", "Marked complete.");

        MigrateTo(TargetMigration);

        Assert.Null(CompletedAtOf(1));
    }

    [Fact]
    public void Down_ShouldDropCompletedAtColumn_AndKeepRows()
    {
        MigrateTo(TargetMigration);
        InsertTask(1, Completed);
        Assert.True(HasColumn("CompletedAt"));

        MigrateTo(PreviousMigration);

        Assert.False(HasColumn("CompletedAt"));
        Assert.Equal(1L, Count("SELECT COUNT(*) FROM \"TaskItems\""));
    }
}
