using TaskFlow.Api.Mappers;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Tests.Mappers;

public class JournalLogEntryMapperTests
{
    [Fact]
    public void ToDto_ShouldUseLiveTitleAndNotMarkDeleted_WhenTaskIsLoaded()
    {
        var log = new JournalLogEntry
        {
            Content = "c",
            TaskItemId = 5,
            TaskItem = new TaskItem { Id = 5, Title = "Live title" },
            LinkedTaskTitleSnapshot = "Old snapshot",
        };

        var dto = JournalLogEntryMapper.ToDto(log);

        Assert.Equal("Live title", dto.LinkedTaskTitle);
        Assert.False(dto.LinkedTaskDeleted);
    }

    [Fact]
    public void ToDto_ShouldUseSnapshotAndMarkDeleted_WhenTaskItemIdIsNullAndSnapshotExists()
    {
        var log = new JournalLogEntry { Content = "c", TaskItemId = null, LinkedTaskTitleSnapshot = "Gone task" };

        var dto = JournalLogEntryMapper.ToDto(log);

        Assert.Equal("Gone task", dto.LinkedTaskTitle);
        Assert.True(dto.LinkedTaskDeleted);
    }

    [Fact]
    public void ToDto_ShouldUseSnapshotAndNotMarkDeleted_WhenTaskIdSetButNavigationNotLoaded()
    {
        var log = new JournalLogEntry { Content = "c", TaskItemId = 5, TaskItem = null, LinkedTaskTitleSnapshot = "Snapshot" };

        var dto = JournalLogEntryMapper.ToDto(log);

        Assert.Equal("Snapshot", dto.LinkedTaskTitle);
        Assert.False(dto.LinkedTaskDeleted);
    }

    [Fact]
    public void ToDto_ShouldReturnNullTitleAndNotDeleted_WhenNoTaskAndNoSnapshot()
    {
        var log = new JournalLogEntry { Content = "c" };

        var dto = JournalLogEntryMapper.ToDto(log);

        Assert.Null(dto.LinkedTaskTitle);
        Assert.False(dto.LinkedTaskDeleted);
    }

    [Fact]
    public void ToDto_ShouldMarkDeleted_WhenTaskItemIdIsNullAndSnapshotIsEmptyString()
    {
        var log = new JournalLogEntry { Content = "c", TaskItemId = null, LinkedTaskTitleSnapshot = "" };

        var dto = JournalLogEntryMapper.ToDto(log);

        Assert.Equal("", dto.LinkedTaskTitle);
        Assert.True(dto.LinkedTaskDeleted);
    }

    [Fact]
    public void ToDto_ShouldCopyFieldsUnchanged_WhenAllValuesSet()
    {
        var created = new DateTime(2026, 5, 10, 8, 0, 0, DateTimeKind.Utc);
        var updated = new DateTime(2026, 5, 11, 9, 30, 0, DateTimeKind.Utc);
        var log = new JournalLogEntry
        {
            Id = 11,
            Content = "Some content",
            JournalEntryId = 22,
            CreatedAt = created,
            UpdatedAt = updated,
            TaskItemId = 33,
        };

        var dto = JournalLogEntryMapper.ToDto(log);

        Assert.Equal(11, dto.Id);
        Assert.Equal("Some content", dto.Content);
        Assert.Equal(22, dto.JournalEntryId);
        Assert.Equal(created, dto.CreatedAt);
        Assert.Equal(updated, dto.UpdatedAt);
        Assert.Equal(33, dto.TaskItemId);
    }

    [Fact]
    public void ToDto_ShouldCopyNullUpdatedAtAndTaskItemId_WhenNotSet()
    {
        var created = new DateTime(2026, 5, 10, 8, 0, 0, DateTimeKind.Utc);
        var log = new JournalLogEntry { Id = 4, Content = "x", JournalEntryId = 8, CreatedAt = created, UpdatedAt = null };

        var dto = JournalLogEntryMapper.ToDto(log);

        Assert.Equal(created, dto.CreatedAt);
        Assert.Null(dto.UpdatedAt);
        Assert.Null(dto.TaskItemId);
    }
}
