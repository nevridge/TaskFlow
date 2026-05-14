using FluentAssertions;
using Moq;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Tests.Services;

public class JournalEntryServiceTests
{
    private readonly Mock<IJournalEntryRepository> _repo = new();
    private readonly JournalEntryService _service;

    public JournalEntryServiceTests()
    {
        _service = new JournalEntryService(_repo.Object);
    }

    [Fact]
    public async Task GetByDateAsync_ShouldDelegateToRepository()
    {
        var date = new DateOnly(2026, 5, 10);
        _repo.Setup(r => r.GetByDateAsync(date)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = date });

        var result = await _service.GetByDateAsync(date);

        result.Should().NotBeNull();
        result!.Date.Should().Be(date);
    }

    [Fact]
    public async Task CreateAsync_ShouldDelegateToRepository()
    {
        var entry = new JournalEntry { Id = 2, Title = "May 11", Date = new DateOnly(2026, 5, 11) };
        _repo.Setup(r => r.AddAsync(entry)).ReturnsAsync(entry);

        var result = await _service.CreateAsync(entry);

        result.Should().BeSameAs(entry);
    }

    [Fact]
    public async Task TodoOperations_ShouldDelegateToRepository()
    {
        _repo.Setup(r => r.TodoExistsAsync(1, 2)).ReturnsAsync(true);

        var exists = await _service.TodoExistsAsync(1, 2);
        await _service.AddTodoAsync(1, 2);
        await _service.RemoveTodoAsync(1, 2);

        exists.Should().BeTrue();
        _repo.Verify(r => r.AddTodoAsync(1, 2), Times.Once);
        _repo.Verify(r => r.RemoveTodoAsync(1, 2), Times.Once);
    }
}
