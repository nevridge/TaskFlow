using FluentAssertions;
using Moq;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Tests.Services;

public class JournalLogEntryServiceTests
{
    private readonly Mock<IJournalLogEntryRepository> _repo = new();
    private readonly JournalLogEntryService _service;

    public JournalLogEntryServiceTests()
    {
        _service = new JournalLogEntryService(_repo.Object);
    }

    [Fact]
    public async Task GetAllByEntryIdAsync_ShouldDelegateToRepository()
    {
        _repo.Setup(r => r.GetAllByEntryIdAsync(1)).ReturnsAsync([new JournalLogEntry { Id = 1, JournalEntryId = 1, Content = "Started" }]);

        var result = await _service.GetAllByEntryIdAsync(1);

        result.Should().ContainSingle();
    }

    [Fact]
    public async Task CreateAndUpdate_ShouldDelegateToRepository()
    {
        var log = new JournalLogEntry { Id = 4, JournalEntryId = 1, Content = "Done" };
        _repo.Setup(r => r.AddAsync(log)).ReturnsAsync(log);

        var created = await _service.CreateAsync(log);
        await _service.UpdateAsync(log);

        created.Should().BeSameAs(log);
        _repo.Verify(r => r.UpdateAsync(log), Times.Once);
    }

    [Fact]
    public async Task DeleteAsync_ShouldDelegateToRepository()
    {
        await _service.DeleteAsync(1, 5);

        _repo.Verify(r => r.DeleteAsync(1, 5), Times.Once);
    }
}
