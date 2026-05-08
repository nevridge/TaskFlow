using FluentAssertions;
using Moq;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Tests.Services;

public class JournalLogEntryServiceTests
{
    private readonly Mock<IJournalLogEntryRepository> _mockRepo;
    private readonly JournalLogEntryService _service;

    public JournalLogEntryServiceTests()
    {
        _mockRepo = new Mock<IJournalLogEntryRepository>();
        _service = new JournalLogEntryService(_mockRepo.Object);
    }

    [Fact]
    public async Task GetAllByEntryIdAsync_ShouldReturnLogEntries()
    {
        var logs = new List<JournalLogEntry>
        {
            new() { Id = 1, Content = "Log 1", JournalEntryId = 1 },
            new() { Id = 2, Content = "Log 2", JournalEntryId = 1 }
        };
        _mockRepo.Setup(r => r.GetAllByEntryIdAsync(1)).ReturnsAsync(logs);

        var result = await _service.GetAllByEntryIdAsync(1);

        result.Should().BeEquivalentTo(logs);
        _mockRepo.Verify(r => r.GetAllByEntryIdAsync(1), Times.Once);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnLogEntry_WhenExists()
    {
        var log = new JournalLogEntry { Id = 1, Content = "Log 1", JournalEntryId = 1 };
        _mockRepo.Setup(r => r.GetByIdAsync(1, 1)).ReturnsAsync(log);

        var result = await _service.GetByIdAsync(1, 1);

        result.Should().BeEquivalentTo(log);
        _mockRepo.Verify(r => r.GetByIdAsync(1, 1), Times.Once);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenNotExists()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1, 999)).ReturnsAsync((JournalLogEntry?)null);

        var result = await _service.GetByIdAsync(1, 999);

        result.Should().BeNull();
    }

    [Fact]
    public async Task CreateAsync_ShouldCreateAndReturnLogEntry()
    {
        var log = new JournalLogEntry { Content = "New log", JournalEntryId = 1 };
        var created = new JournalLogEntry { Id = 1, Content = "New log", JournalEntryId = 1 };
        _mockRepo.Setup(r => r.AddAsync(log)).ReturnsAsync(created);

        var result = await _service.CreateAsync(log);

        result.Should().BeEquivalentTo(created);
        _mockRepo.Verify(r => r.AddAsync(log), Times.Once);
    }

    [Fact]
    public async Task UpdateAsync_ShouldCallRepositoryUpdate()
    {
        var log = new JournalLogEntry { Id = 1, Content = "Updated", JournalEntryId = 1 };
        _mockRepo.Setup(r => r.UpdateAsync(log)).Returns(Task.CompletedTask);

        await _service.UpdateAsync(log);

        _mockRepo.Verify(r => r.UpdateAsync(log), Times.Once);
    }

    [Fact]
    public async Task DeleteAsync_ShouldCallRepositoryDelete()
    {
        _mockRepo.Setup(r => r.DeleteAsync(1, 5)).Returns(Task.CompletedTask);

        await _service.DeleteAsync(1, 5);

        _mockRepo.Verify(r => r.DeleteAsync(1, 5), Times.Once);
    }
}
