using Microsoft.Extensions.Logging;
using Moq;
using TaskFlow.Api.Extensions;

namespace TaskFlow.Api.Tests.Extensions;

public class PersistenceServiceExtensionsTests
{
    [Fact]
    public void EnsureSqliteDirectoryExists_NullConnectionString_DoesNotThrow()
    {
        var act = () => PersistenceServiceExtensions.EnsureSqliteDirectoryExists(null);

        Assert.Null(Record.Exception(act));
    }

    [Fact]
    public void EnsureSqliteDirectoryExists_EmptyConnectionString_DoesNotThrow()
    {
        var act = () => PersistenceServiceExtensions.EnsureSqliteDirectoryExists(string.Empty);

        Assert.Null(Record.Exception(act));
    }

    [Fact]
    public void EnsureSqliteDirectoryExists_InMemoryDataSource_DoesNotThrow()
    {
        var act = () => PersistenceServiceExtensions.EnsureSqliteDirectoryExists("Data Source=:memory:");

        Assert.Null(Record.Exception(act));
    }

    [Fact]
    public void EnsureSqliteDirectoryExists_FileMemoryDataSource_DoesNotThrow()
    {
        var act = () => PersistenceServiceExtensions.EnsureSqliteDirectoryExists("Data Source=file::memory:");

        Assert.Null(Record.Exception(act));
    }

    [Fact]
    public void EnsureSqliteDirectoryExists_ExistingDirectory_DoesNotThrow()
    {
        var existingDir = Path.GetTempPath();
        var connectionString = $"Data Source={Path.Combine(existingDir, "tasks.db")}";

        var act = () => PersistenceServiceExtensions.EnsureSqliteDirectoryExists(connectionString);

        Assert.Null(Record.Exception(act));
    }

    [Fact]
    public void EnsureSqliteDirectoryExists_NonExistentDirectory_CreatesDirectory()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString(), "sqlitetest");
        var connectionString = $"Data Source={Path.Combine(tempDir, "tasks.db")}";

        try
        {
            PersistenceServiceExtensions.EnsureSqliteDirectoryExists(connectionString);

            Assert.True(Directory.Exists(tempDir));
        }
        finally
        {
            if (Directory.Exists(tempDir))
            {
                Directory.Delete(tempDir, recursive: true);
            }
        }
    }

    [Fact]
    public void EnsureSqliteDirectoryExists_NonExistentDirectory_WithLogger_LogsCreation()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString(), "sqlitetest");
        var connectionString = $"Data Source={Path.Combine(tempDir, "tasks.db")}";
        var mockLogger = new Mock<ILogger>();
        mockLogger.Setup(l => l.IsEnabled(It.IsAny<LogLevel>())).Returns(true);

        try
        {
            PersistenceServiceExtensions.EnsureSqliteDirectoryExists(connectionString, mockLogger.Object);

            mockLogger.Verify(
                l => l.Log(
                    LogLevel.Information,
                    It.IsAny<EventId>(),
                    It.IsAny<It.IsAnyType>(),
                    It.IsAny<Exception?>(),
                    It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
                Times.Once);
        }
        finally
        {
            if (Directory.Exists(tempDir))
            {
                Directory.Delete(tempDir, recursive: true);
            }
        }
    }
}
