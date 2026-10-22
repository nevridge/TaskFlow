using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;

namespace TaskFlow.Api.Tests.Migrations;

/// <summary>
/// Runs the real migration chain against real in-memory SQLite to prove the additive Up and the
/// status-restoring Down of <c>AddTaskItemBlockedStatus</c>.
/// </summary>
public class AddTaskItemBlockedStatusMigrationTests : IDisposable
{
    private const string PreviousMigration = "20261022141248_RemoveTaskItemIsComplete";
    private const string TargetMigration = "20261022173755_AddTaskItemBlockedStatus";

    private const int Todo = 1;
    private const int Completed = 2;
    private const int Blocked = 3;

    private readonly SqliteConnection _connection;
    private readonly TaskDbContext _context;

    public AddTaskItemBlockedStatusMigrationTests()
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

    private void InsertTask(int id, int status) =>
        Exec($"INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"Status\", \"Priority\", \"MoveCount\") VALUES ({id}, 'Task {id}', {status}, 1, 0)");

    [Fact]
    public void Up_ShouldAddThreeNullableColumns_AndLeaveExistingRowsNull()
    {
        MigrateTo(PreviousMigration);
        InsertTask(1, Todo);
        InsertTask(2, Completed);
        Assert.False(HasColumn("BlockedReason"));

        MigrateTo(TargetMigration);

        Assert.True(HasColumn("BlockedReason"));
        Assert.True(HasColumn("BlockedAt"));
        Assert.True(HasColumn("PreviousStatus"));
        Assert.Equal(2L, Count("SELECT COUNT(*) FROM \"TaskItems\" WHERE \"BlockedReason\" IS NULL AND \"BlockedAt\" IS NULL AND \"PreviousStatus\" IS NULL"));
        Assert.Equal(Todo, StatusOf(1));
        Assert.Equal(Completed, StatusOf(2));
        Assert.Equal(0L, Count("SELECT COUNT(*) FROM pragma_table_info('TaskItems') WHERE name IN ('BlockedReason','BlockedAt','PreviousStatus') AND \"notnull\" = 1"));
    }

    [Fact]
    public void Down_ShouldRestorePreviousStatusOrTodo_AndDropColumns()
    {
        MigrateTo(TargetMigration);
        InsertTask(1, Blocked);
        Exec("UPDATE \"TaskItems\" SET \"PreviousStatus\" = 0, \"BlockedReason\" = 'x', \"BlockedAt\" = '2026-10-01 00:00:00' WHERE \"Id\" = 1");
        InsertTask(2, Blocked);
        Exec("UPDATE \"TaskItems\" SET \"PreviousStatus\" = 1 WHERE \"Id\" = 2");
        InsertTask(3, Blocked);
        InsertTask(4, Completed);

        MigrateTo(PreviousMigration);

        Assert.Equal(0L, StatusOf(1));
        Assert.Equal(Todo, StatusOf(2));
        Assert.Equal(Todo, StatusOf(3));
        Assert.Equal(Completed, StatusOf(4));
        Assert.False(HasColumn("BlockedReason"));
        Assert.False(HasColumn("BlockedAt"));
        Assert.False(HasColumn("PreviousStatus"));
        Assert.Equal(4L, Count("SELECT COUNT(*) FROM \"TaskItems\""));
        Assert.Equal(0L, Count("SELECT COUNT(*) FROM \"TaskItems\" WHERE \"Status\" = 3"));
    }
}
