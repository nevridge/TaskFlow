using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;

namespace TaskFlow.Api.Tests.Migrations;

/// <summary>
/// Runs the real migration chain against real in-memory SQLite to prove the additive Up and the
/// InProgress-remapping Down of <c>AddTaskItemStartedAt</c>.
/// </summary>
public class AddTaskItemStartedAtMigrationTests : IDisposable
{
    private const string BlockedMigration = "20261022173755_AddTaskItemBlockedStatus";
    private const string BeforeBlockedMigration = "20261022141248_RemoveTaskItemIsComplete";
    private const string TargetMigration = "20261030161206_AddTaskItemStartedAt";

    private const int Draft = 0;
    private const int Todo = 1;
    private const int Completed = 2;
    private const int Blocked = 3;
    private const int InProgress = 4;

    private readonly SqliteConnection _connection;
    private readonly TaskDbContext _context;

    public AddTaskItemStartedAtMigrationTests()
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

    private long StatusOf(int id) => Count($"SELECT \"Status\" FROM \"TaskItems\" WHERE \"Id\" = {id}");

    private long PreviousStatusOf(int id) => Count($"SELECT \"PreviousStatus\" FROM \"TaskItems\" WHERE \"Id\" = {id}");

    private void InsertTask(int id, int status) =>
        Exec($"INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"Status\", \"Priority\", \"MoveCount\") VALUES ({id}, 'Task {id}', {status}, 1, 0)");

    private void SetBlocked(int id, int previous) =>
        Exec($"UPDATE \"TaskItems\" SET \"PreviousStatus\" = {previous}, \"BlockedAt\" = '2026-10-01 00:00:00' WHERE \"Id\" = {id}");

    [Fact]
    public void Up_ShouldAddNullableStartedAtColumn_AndKeepExistingRowsWithNull()
    {
        MigrateTo(BlockedMigration);
        InsertTask(1, Todo);
        InsertTask(2, Completed);
        Assert.False(HasColumn("StartedAt"));

        MigrateTo(TargetMigration);

        Assert.True(HasColumn("StartedAt"));
        Assert.Equal(2L, Count("SELECT COUNT(*) FROM \"TaskItems\" WHERE \"StartedAt\" IS NULL"));
        Assert.Equal(Todo, StatusOf(1));
        Assert.Equal(Completed, StatusOf(2));
        Assert.Equal(0L, Count("SELECT COUNT(*) FROM pragma_table_info('TaskItems') WHERE name = 'StartedAt' AND \"notnull\" = 1"));
    }

    [Fact]
    public void Down_ShouldRemapInProgressAndBlockedFromInProgressToTodo_AndDropColumn()
    {
        MigrateTo(TargetMigration);
        InsertTask(1, InProgress);
        Exec("UPDATE \"TaskItems\" SET \"StartedAt\" = '2026-10-01 00:00:00' WHERE \"Id\" = 1");
        InsertTask(2, Blocked);
        SetBlocked(2, InProgress);
        InsertTask(3, Blocked);
        SetBlocked(3, Draft);
        InsertTask(4, Completed);

        MigrateTo(BlockedMigration);

        Assert.Equal(Todo, StatusOf(1));
        Assert.Equal(Blocked, StatusOf(2));
        Assert.Equal(Todo, PreviousStatusOf(2));
        Assert.Equal(Blocked, StatusOf(3));
        Assert.Equal(Draft, PreviousStatusOf(3));
        Assert.Equal(Completed, StatusOf(4));
        Assert.False(HasColumn("StartedAt"));
        Assert.Equal(4L, Count("SELECT COUNT(*) FROM \"TaskItems\""));
        Assert.Equal(0L, Count("SELECT COUNT(*) FROM \"TaskItems\" WHERE \"Status\" = 4 OR \"PreviousStatus\" = 4"));
    }

    [Fact]
    public void Down_ThroughOlderBlockedDown_ShouldNeverLeaveInProgressStatus()
    {
        MigrateTo(TargetMigration);
        InsertTask(1, InProgress);
        InsertTask(2, Blocked);
        SetBlocked(2, InProgress);

        MigrateTo(BeforeBlockedMigration);

        Assert.Equal(Todo, StatusOf(1));
        Assert.Equal(Todo, StatusOf(2));
        Assert.Equal(0L, Count("SELECT COUNT(*) FROM \"TaskItems\" WHERE \"Status\" = 4"));
        Assert.False(HasColumn("StartedAt"));
        Assert.False(HasColumn("PreviousStatus"));
    }
}
