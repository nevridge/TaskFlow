using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Tests.Migrations;

/// <summary>
/// Runs the real migration chain against real in-memory SQLite (not EnsureCreated) to prove the data
/// normalization, the synthetic history events and the SQLite column drop (table rebuild).
/// </summary>
public class RemoveTaskItemIsCompleteMigrationTests : IDisposable
{
    private const string PreviousMigration = "20261009173936_AddProjects";
    private const string TargetMigration = "20261022141248_RemoveTaskItemIsComplete";

    private const int Draft = 0;
    private const int Todo = 1;
    private const int Completed = 2;

    private readonly SqliteConnection _connection;
    private readonly TaskDbContext _context;

    public RemoveTaskItemIsCompleteMigrationTests()
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

    private T Scalar<T>(string sql)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = sql;
        return (T)Convert.ChangeType(command.ExecuteScalar()!, typeof(T));
    }

    private List<string> Strings(string sql)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = sql;
        using var reader = command.ExecuteReader();
        var values = new List<string>();
        while (reader.Read())
        {
            values.Add(reader.GetString(0));
        }

        return values;
    }

    private bool HasIsCompleteColumn() =>
        Scalar<long>("SELECT COUNT(*) FROM pragma_table_info('TaskItems') WHERE name = 'IsComplete'") > 0;

    private int StatusOf(int id) => Scalar<int>($"SELECT \"Status\" FROM \"TaskItems\" WHERE \"Id\" = {id}");

    private void SeedAtPreviousMigration()
    {
        Exec("INSERT INTO \"JournalEntries\" (\"Id\", \"Title\", \"Date\", \"CreatedAt\") VALUES (1, 'J', '2026-10-01', '2026-10-01 00:00:00')");

        // Id, IsComplete, Status: A flag+Todo, B flag+Draft, C flag+Completed, D Completed only, E open, F draft.
        var rows = new (int Id, int Flag, int Status)[]
        {
            (1, 1, Todo), (2, 1, Draft), (3, 1, Completed), (4, 0, Completed), (5, 0, Todo), (6, 0, Draft)
        };
        foreach (var (id, flag, status) in rows)
        {
            Exec($"INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"Description\", \"IsComplete\", \"Status\", \"Priority\", \"MoveCount\") " +
                 $"VALUES ({id}, 'Task {id}', 'Desc {id}', {flag}, {status}, 1, 0)");
        }

        // Self-FK, journal FK and join table rows that must survive the table rebuild.
        Exec("UPDATE \"TaskItems\" SET \"ParentTaskItemId\" = 5 WHERE \"Id\" = 1");
        Exec("UPDATE \"TaskItems\" SET \"CurrentJournalEntryId\" = 1 WHERE \"Id\" = 1");
        Exec("INSERT INTO \"JournalEntryTaskItem\" (\"JournalEntryId\", \"TodosId\") VALUES (1, 1)");
        Exec("INSERT INTO \"TaskItemEvents\" (\"TaskItemId\", \"EventType\", \"OccurredAtUtc\", \"ChangeSummary\") " +
             "VALUES (3, 'TaskCreated', '2026-01-01 00:00:00.000', 'seeded')");

        // Other tables referencing TaskItems: Notes (cascade) and JournalLogEntries (set null).
        Exec("INSERT INTO \"Notes\" (\"Id\", \"Content\", \"CreatedAt\", \"TaskItemId\") VALUES (1, 'Note', '2026-01-01 00:00:00', 1)");
        Exec("INSERT INTO \"JournalLogEntries\" (\"Id\", \"Content\", \"CreatedAt\", \"JournalEntryId\", \"TaskItemId\") " +
             "VALUES (1, 'Log', '2026-01-01 00:00:00', 1, 1)");
    }

    [Fact]
    public void Migration_ShouldNormalizeStatusDropColumnAndWriteSyntheticEvents()
    {
        MigrateTo(PreviousMigration);
        Assert.True(HasIsCompleteColumn());
        SeedAtPreviousMigration();

        var before = DateTime.UtcNow.AddSeconds(-2);
        MigrateTo(TargetMigration);
        var after = DateTime.UtcNow.AddSeconds(2);

        // Status results.
        Assert.Equal(Completed, StatusOf(1));
        Assert.Equal(Completed, StatusOf(2));
        Assert.Equal(Completed, StatusOf(3));
        Assert.Equal(Completed, StatusOf(4));
        Assert.Equal(Todo, StatusOf(5));
        Assert.Equal(Draft, StatusOf(6));
        Assert.False(HasIsCompleteColumn());

        // Synthetic events: exactly one for A and B, none for C, D, E, F beyond C's seeded event.
        using var verify = new TaskDbContext(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options);
        var events = verify.TaskItemEvents.AsNoTracking().OrderBy(e => e.Id).ToList();
        Assert.Equal(3, events.Count);

        foreach (var taskId in new[] { 1, 2 })
        {
            var synthetic = Assert.Single(events, e => e.TaskItemId == taskId);
            Assert.Equal("Completed", synthetic.EventType);
            Assert.Contains("data migration", synthetic.ChangeSummary);
            Assert.Equal(DateTimeKind.Utc, synthetic.OccurredAtUtc.Kind);
            Assert.InRange(synthetic.OccurredAtUtc, before, after);
            Assert.Null(synthetic.FromJournalEntryId);
            Assert.Null(synthetic.ToJournalEntryId);
            Assert.Null(synthetic.FromJournalDate);
            Assert.Null(synthetic.ToJournalDate);
        }

        var seeded = Assert.Single(events, e => e.TaskItemId == 3);
        Assert.Equal("TaskCreated", seeded.EventType);
        Assert.DoesNotContain(events, e => e.TaskItemId is 4 or 5 or 6);
    }

    [Fact]
    public void Migration_ShouldPreserveForeignKeysIndexesAndRowData_AcrossTableRebuild()
    {
        MigrateTo(PreviousMigration);
        SeedAtPreviousMigration();

        MigrateTo(TargetMigration);

        var foreignKeyColumns = Strings("SELECT \"from\" FROM pragma_foreign_key_list('TaskItems')");
        Assert.Contains("ParentTaskItemId", foreignKeyColumns);
        Assert.Contains("CurrentJournalEntryId", foreignKeyColumns);
        Assert.Contains("ProjectId", foreignKeyColumns);

        var selfFkTarget = Strings("SELECT \"table\" FROM pragma_foreign_key_list('TaskItems') WHERE \"from\" = 'ParentTaskItemId'");
        Assert.Equal(["TaskItems"], selfFkTarget);

        var indexes = Strings("SELECT name FROM pragma_index_list('TaskItems')");
        Assert.Contains("IX_TaskItems_ParentTaskItemId", indexes);
        Assert.Contains("IX_TaskItems_CurrentJournalEntryId", indexes);
        Assert.Contains("IX_TaskItems_ProjectId", indexes);

        Assert.Equal(5, Scalar<int>("SELECT \"ParentTaskItemId\" FROM \"TaskItems\" WHERE \"Id\" = 1"));
        Assert.Equal(1, Scalar<int>("SELECT \"CurrentJournalEntryId\" FROM \"TaskItems\" WHERE \"Id\" = 1"));
        Assert.Equal("Desc 1", Scalar<string>("SELECT \"Description\" FROM \"TaskItems\" WHERE \"Id\" = 1"));
        Assert.Equal(1L, Scalar<long>("SELECT COUNT(*) FROM \"JournalEntryTaskItem\""));
        Assert.Equal(6L, Scalar<long>("SELECT COUNT(*) FROM \"TaskItems\""));
        Assert.Equal(1L, Scalar<long>("SELECT COUNT(*) FROM \"Notes\" WHERE \"TaskItemId\" = 1"));
        Assert.Equal(1L, Scalar<long>("SELECT COUNT(*) FROM \"JournalLogEntries\" WHERE \"TaskItemId\" = 1"));
        Assert.Equal(0L, Scalar<long>("SELECT COUNT(*) FROM pragma_foreign_key_check()"));
    }

    [Fact]
    public void Down_ShouldRestoreColumnFromStatus_KeepSyntheticEvents_AndNotDuplicateOnReapply()
    {
        MigrateTo(PreviousMigration);
        SeedAtPreviousMigration();
        MigrateTo(TargetMigration);
        var eventCountAfterUp = Scalar<long>("SELECT COUNT(*) FROM \"TaskItemEvents\"");
        Assert.Equal(3L, eventCountAfterUp);

        MigrateTo(PreviousMigration);

        Assert.True(HasIsCompleteColumn());
        foreach (var id in new[] { 1, 2, 3, 4 })
        {
            Assert.Equal(1L, Scalar<long>($"SELECT \"IsComplete\" FROM \"TaskItems\" WHERE \"Id\" = {id}"));
        }

        foreach (var id in new[] { 5, 6 })
        {
            Assert.Equal(0L, Scalar<long>($"SELECT \"IsComplete\" FROM \"TaskItems\" WHERE \"Id\" = {id}"));
        }

        Assert.Equal(1L, Scalar<long>("SELECT COUNT(*) FROM pragma_table_info('TaskItems') WHERE name = 'IsComplete' AND \"notnull\" = 1"));
        Assert.Equal(eventCountAfterUp, Scalar<long>("SELECT COUNT(*) FROM \"TaskItemEvents\""));

        MigrateTo(TargetMigration);

        Assert.False(HasIsCompleteColumn());
        Assert.Equal(eventCountAfterUp, Scalar<long>("SELECT COUNT(*) FROM \"TaskItemEvents\""));
    }

    [Fact]
    public void Migration_ShouldBeNoOpForData_WhenNoRowsNeedNormalizing()
    {
        MigrateTo(PreviousMigration);
        Exec("INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"IsComplete\", \"Status\", \"Priority\", \"MoveCount\") VALUES (1, 'Open', 0, 1, 1, 0)");

        MigrateTo(TargetMigration);

        Assert.Equal(Todo, StatusOf(1));
        Assert.Equal(0L, Scalar<long>("SELECT COUNT(*) FROM \"TaskItemEvents\""));
    }
}
