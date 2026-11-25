using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;

namespace TaskFlow.Api.Tests.Migrations;

/// <summary>
/// Runs the real migration chain against real in-memory SQLite. Adding the goal foreign key rebuilds the
/// <c>TaskItems</c> table, which events, notes, log entries, journal links and its own parent key reference, so every
/// one of them must be proven intact in both directions.
/// </summary>
public sealed class AddGoalsMigrationTests : IDisposable
{
    private const string BeforeMigration = "20261125020053_AddAreas";
    private const string TargetMigration = "20261125233644_AddGoals";

    private readonly SqliteConnection _connection;
    private readonly TaskDbContext _context;

    public AddGoalsMigrationTests()
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

    private object Scalar(string sql)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar();
    }

    private void Seed()
    {
        const string at = "'2026-05-01 00:00:00'";
        Exec($"INSERT INTO \"Projects\" (\"Id\", \"Name\", \"IsArchived\", \"CreatedAt\") VALUES (7, 'Alpha', 0, {at})");
        Exec($"INSERT INTO \"JournalEntries\" (\"Id\", \"Title\", \"Date\", \"CreatedAt\") VALUES (4, 'Day', '2026-05-01', {at})");
        Exec("INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"Status\", \"Priority\", \"MoveCount\", \"ProjectId\", \"CurrentJournalEntryId\") VALUES (1, 'Parent', 1, 1, 2, 7, 4)");
        Exec("INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"Status\", \"Priority\", \"MoveCount\", \"ProjectId\", \"ParentTaskItemId\") VALUES (2, 'Child', 4, 2, 0, 7, 1)");
        Exec($"INSERT INTO \"TaskItemEvents\" (\"TaskItemId\", \"EventType\", \"OccurredAtUtc\") VALUES (1, 'TaskCreated', {at})");
        Exec($"INSERT INTO \"Notes\" (\"TaskItemId\", \"Content\", \"CreatedAt\") VALUES (2, 'n', {at})");
        Exec($"INSERT INTO \"JournalLogEntries\" (\"JournalEntryId\", \"TaskItemId\", \"Content\", \"CreatedAt\") VALUES (4, 1, 'log', {at})");
        Exec("INSERT INTO \"JournalEntryTaskItem\" (\"JournalEntryId\", \"TodosId\") VALUES (4, 1)");
    }

    private void AssertSeedIntact()
    {
        Assert.Equal("Parent|1|1|2|7|4", Scalar(
            "SELECT \"Title\" || '|' || \"Status\" || '|' || \"Priority\" || '|' || \"MoveCount\" || '|' || \"ProjectId\" || '|' || \"CurrentJournalEntryId\" FROM \"TaskItems\" WHERE \"Id\" = 1"));
        Assert.Equal("Child|4|1|7", Scalar(
            "SELECT \"Title\" || '|' || \"Status\" || '|' || \"ParentTaskItemId\" || '|' || \"ProjectId\" FROM \"TaskItems\" WHERE \"Id\" = 2"));
        Assert.Equal(1L, Scalar("SELECT COUNT(*) FROM \"TaskItemEvents\" WHERE \"TaskItemId\" = 1"));
        Assert.Equal(1L, Scalar("SELECT COUNT(*) FROM \"Notes\" WHERE \"TaskItemId\" = 2"));
        Assert.Equal(1L, Scalar("SELECT COUNT(*) FROM \"JournalLogEntries\" WHERE \"TaskItemId\" = 1"));
        Assert.Equal(1L, Scalar("SELECT COUNT(*) FROM \"JournalEntryTaskItem\" WHERE \"JournalEntryId\" = 4 AND \"TodosId\" = 1"));
        Assert.Null(Scalar("SELECT 1 FROM pragma_foreign_key_check"));
    }

    [Fact]
    public void Up_ShouldKeepEveryTaskReference_AndCreateNoGoals()
    {
        MigrateTo(BeforeMigration);
        Seed();

        MigrateTo(TargetMigration);

        AssertSeedIntact();
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM \"TaskItems\" WHERE \"GoalId\" IS NOT NULL"));
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM \"Goals\""));
    }

    [Fact]
    public void Down_ShouldRemoveGoals_AndKeepEveryTaskReference()
    {
        MigrateTo(BeforeMigration);
        Seed();
        MigrateTo(TargetMigration);
        Exec("INSERT INTO \"Goals\" (\"Id\", \"ProjectId\", \"Title\", \"Status\", \"DisplayOrder\", \"StatusChangedAt\", \"CreatedAt\") VALUES (3, 7, 'G', 0, 0, '2026-05-01 00:00:00', '2026-05-01 00:00:00')");
        Exec("UPDATE \"TaskItems\" SET \"GoalId\" = 3");

        MigrateTo(BeforeMigration);

        AssertSeedIntact();
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM pragma_table_info('TaskItems') WHERE name = 'GoalId'"));
        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'Goals'"));
    }
}
