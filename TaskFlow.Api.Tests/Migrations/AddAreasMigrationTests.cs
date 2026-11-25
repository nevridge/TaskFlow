using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;

namespace TaskFlow.Api.Tests.Migrations;

/// <summary>
/// Runs the real migration chain against real in-memory SQLite. Adding the area foreign key rebuilds the
/// <c>Projects</c> table, which <c>TaskItems</c> references with SET NULL, so the data must be proven intact.
/// </summary>
public sealed class AddAreasMigrationTests : IDisposable
{
    private const string BeforeMigration = "20261031024516_AddTaskItemCompletedAt";
    private const string TargetMigration = "20261125020053_AddAreas";

    private readonly SqliteConnection _connection;
    private readonly TaskDbContext _context;

    public AddAreasMigrationTests()
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

    private void SeedProjectWithTask()
    {
        Exec("INSERT INTO \"Projects\" (\"Id\", \"Name\", \"Description\", \"IsArchived\", \"CreatedAt\") VALUES (7, 'Alpha', 'd', 1, '2026-05-01 00:00:00')");
        Exec("INSERT INTO \"TaskItems\" (\"Id\", \"Title\", \"Status\", \"Priority\", \"MoveCount\", \"ProjectId\") VALUES (1, 'T', 1, 1, 0, 7)");
    }

    [Fact]
    public void Up_ShouldKeepProjectsTaskLinksAndCaseInsensitiveNameIndex()
    {
        MigrateTo(BeforeMigration);
        SeedProjectWithTask();

        MigrateTo(TargetMigration);

        Assert.Equal("Alpha|d|1", Scalar("SELECT \"Name\" || '|' || \"Description\" || '|' || \"IsArchived\" FROM \"Projects\" WHERE \"Id\" = 7"));
        Assert.Equal(DBNull.Value, Scalar("SELECT \"AreaId\" FROM \"Projects\" WHERE \"Id\" = 7"));
        Assert.Equal(7L, Scalar("SELECT \"ProjectId\" FROM \"TaskItems\" WHERE \"Id\" = 1"));
        Assert.Equal(1L, Scalar("SELECT \"unique\" FROM pragma_index_list('Projects') WHERE name = 'IX_Projects_Name'"));
        var duplicate = Assert.Throws<SqliteException>(() => Exec(
            "INSERT INTO \"Projects\" (\"Name\", \"IsArchived\", \"CreatedAt\") VALUES ('ALPHA', 0, '2026-05-01 00:00:00')"));
        Assert.Contains("UNIQUE", duplicate.Message, StringComparison.Ordinal);
        Assert.Null(Scalar("SELECT 1 FROM pragma_foreign_key_check"));
    }

    [Fact]
    public void Down_ShouldRemoveAreas_AndKeepProjectsAndTaskLinks()
    {
        MigrateTo(BeforeMigration);
        SeedProjectWithTask();
        MigrateTo(TargetMigration);

        MigrateTo(BeforeMigration);

        Assert.Equal(0L, Scalar("SELECT COUNT(*) FROM pragma_table_info('Projects') WHERE name = 'AreaId'"));
        Assert.Equal("Alpha", Scalar("SELECT \"Name\" FROM \"Projects\" WHERE \"Id\" = 7"));
        Assert.Equal(7L, Scalar("SELECT \"ProjectId\" FROM \"TaskItems\" WHERE \"Id\" = 1"));
    }
}
