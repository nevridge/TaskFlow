using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;

namespace TaskFlow.Api.Tests.Migrations;

/// <summary>
/// Runs the real migration chain against real in-memory SQLite to prove that
/// <c>ConvertTaskItemDueDateToDateOnly</c> reduces stored DueDate text to its date part.
/// </summary>
public class ConvertTaskItemDueDateToDateOnlyMigrationTests : IDisposable
{
    private const string BeforeMigration = "20261030161206_AddTaskItemStartedAt";
    private const string TargetMigration = "20261030234403_ConvertTaskItemDueDateToDateOnly";

    private readonly SqliteConnection _connection;
    private readonly TaskDbContext _context;

    public ConvertTaskItemDueDateToDateOnlyMigrationTests()
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

    private void InsertTask(int id, string dueDate)
    {
        var due = dueDate is null ? "NULL" : $"'{dueDate}'";
        Exec($"INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"Status\", \"Priority\", \"MoveCount\", \"DueDate\") VALUES ({id}, 'Task {id}', 1, 1, 0, {due})");
    }

    private string StoredDueDate(int id) => Scalar($"SELECT \"DueDate\" FROM \"TaskItems\" WHERE \"Id\" = {id}") as string;

    [Fact]
    public void Up_ShouldKeepOnlyDatePart_ForAllStoredFormats_AndLeaveNullUntouched()
    {
        MigrateTo(BeforeMigration);
        InsertTask(1, "2026-05-01 00:00:00.0000000");
        InsertTask(2, "2026-05-01 00:00:00");
        InsertTask(3, "2026-05-01T00:00:00");
        InsertTask(4, "2026-05-01 23:59:59");
        InsertTask(5, null);

        MigrateTo(TargetMigration);

        Assert.Equal("2026-05-01", StoredDueDate(1));
        Assert.Equal("2026-05-01", StoredDueDate(2));
        Assert.Equal("2026-05-01", StoredDueDate(3));
        Assert.Equal("2026-05-01", StoredDueDate(4));
        Assert.Equal(DBNull.Value, Scalar("SELECT \"DueDate\" FROM \"TaskItems\" WHERE \"Id\" = 5"));
    }

    [Fact]
    public async Task Up_ShouldLeaveRowsReadableAsDateOnlyThroughDbContext()
    {
        MigrateTo(BeforeMigration);
        InsertTask(1, "2026-05-01 00:00:00.0000000");
        InsertTask(2, null);

        MigrateTo(TargetMigration);

        var tasks = await _context.TaskItems.AsNoTracking().OrderBy(t => t.Id).ToListAsync();
        Assert.Equal(new DateOnly(2026, 5, 1), tasks[0].DueDate);
        Assert.Null(tasks[1].DueDate);
    }

    [Fact]
    public void Up_ShouldBeIdempotent_WhenValuesAreAlreadyDateOnly()
    {
        MigrateTo(TargetMigration);
        InsertTask(1, "2026-05-01");

        MigrateTo(BeforeMigration);
        MigrateTo(TargetMigration);

        Assert.Equal("2026-05-01", StoredDueDate(1));
    }

    [Fact]
    public void Down_ShouldKeepTextColumnAndRestoreMidnightTime_WithRowsStillReadable()
    {
        MigrateTo(TargetMigration);
        InsertTask(1, "2026-05-01");
        InsertTask(2, null);

        MigrateTo(BeforeMigration);

        Assert.Equal("TEXT", Scalar("SELECT type FROM pragma_table_info('TaskItems') WHERE name = 'DueDate'"));
        Assert.Equal("2026-05-01 00:00:00", StoredDueDate(1));
        Assert.Equal(DBNull.Value, Scalar("SELECT \"DueDate\" FROM \"TaskItems\" WHERE \"Id\" = 2"));
        Assert.Equal(2L, Scalar("SELECT COUNT(*) FROM \"TaskItems\""));
    }
}
