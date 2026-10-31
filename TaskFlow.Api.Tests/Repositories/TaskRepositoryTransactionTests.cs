using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

// Real SQLite: the EF InMemory provider has no transaction support.
public class TaskRepositoryTransactionTests
{
    private static (SqliteConnection Connection, DbContextOptions<TaskDbContext> Options) CreateDatabase()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(connection).Options;
        using var context = new TaskDbContext(options);
        context.Database.EnsureCreated();
        return (connection, options);
    }

    [Fact]
    public async Task BeginTransactionAsync_ShouldPersistWrites_WhenCommitted()
    {
        var (connection, options) = CreateDatabase();
        await using var _ = connection;
        await using var context = new TaskDbContext(options);
        var repo = new TaskRepository(context);

        await using (var tx = await repo.BeginTransactionAsync())
        {
            await repo.AddAsync(new TaskItem { Title = "Committed", Status = Status.Todo });
            await tx.CommitAsync();
        }

        await using var verify = new TaskDbContext(options);
        Assert.Equal(["Committed"], await verify.TaskItems.Select(t => t.Title).ToListAsync());
    }

    [Fact]
    public async Task BeginTransactionAsync_ShouldRollBackWrites_WhenDisposedWithoutCommit()
    {
        var (connection, options) = CreateDatabase();
        await using var _ = connection;
        await using var context = new TaskDbContext(options);
        var repo = new TaskRepository(context);

        await using (await repo.BeginTransactionAsync())
        {
            await repo.AddAsync(new TaskItem { Title = "Discarded", Status = Status.Todo });
        }

        await using var verify = new TaskDbContext(options);
        Assert.Empty(await verify.TaskItems.ToListAsync());
    }
}
