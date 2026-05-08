using FluentAssertions;
using Moq;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Tests.Services;

public class JournalEntryServiceTests
{
    private readonly Mock<IJournalEntryRepository> _mockRepo;
    private readonly JournalEntryService _service;

    public JournalEntryServiceTests()
    {
        _mockRepo = new Mock<IJournalEntryRepository>();
        _service = new JournalEntryService(_mockRepo.Object);
    }

    [Fact]
    public async Task GetAllAsync_ShouldReturnAllEntries()
    {
        var entries = new List<JournalEntry>
        {
            new() { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) },
            new() { Id = 2, Title = "Day 2", Date = new DateOnly(2026, 5, 2) }
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync(entries);

        var result = await _service.GetAllAsync();

        result.Should().BeEquivalentTo(entries);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Once);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnEntry_WhenExists()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(entry);

        var result = await _service.GetByIdAsync(1);

        result.Should().BeEquivalentTo(entry);
        _mockRepo.Verify(r => r.GetByIdAsync(1), Times.Once);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenNotExists()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((JournalEntry?)null);

        var result = await _service.GetByIdAsync(999);

        result.Should().BeNull();
    }

    [Fact]
    public async Task GetByDateAsync_ShouldReturnEntry_WhenExists()
    {
        var date = new DateOnly(2026, 5, 1);
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = date };
        _mockRepo.Setup(r => r.GetByDateAsync(date)).ReturnsAsync(entry);

        var result = await _service.GetByDateAsync(date);

        result.Should().BeEquivalentTo(entry);
        _mockRepo.Verify(r => r.GetByDateAsync(date), Times.Once);
    }

    [Fact]
    public async Task CreateAsync_ShouldCreateAndReturnEntry()
    {
        var entry = new JournalEntry { Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var created = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        _mockRepo.Setup(r => r.AddAsync(entry)).ReturnsAsync(created);

        var result = await _service.CreateAsync(entry);

        result.Should().BeEquivalentTo(created);
        _mockRepo.Verify(r => r.AddAsync(entry), Times.Once);
    }

    [Fact]
    public async Task UpdateAsync_ShouldCallRepositoryUpdate()
    {
        var entry = new JournalEntry { Id = 1, Title = "Updated", Date = new DateOnly(2026, 5, 1) };
        _mockRepo.Setup(r => r.UpdateAsync(entry)).Returns(Task.CompletedTask);

        await _service.UpdateAsync(entry);

        _mockRepo.Verify(r => r.UpdateAsync(entry), Times.Once);
    }

    [Fact]
    public async Task DeleteAsync_ShouldCallRepositoryDelete()
    {
        _mockRepo.Setup(r => r.DeleteAsync(1)).Returns(Task.CompletedTask);

        await _service.DeleteAsync(1);

        _mockRepo.Verify(r => r.DeleteAsync(1), Times.Once);
    }

    [Fact]
    public async Task GetTodosAsync_ShouldReturnTodos()
    {
        var tasks = new List<TaskItem>
        {
            new() { Id = 1, Title = "Task 1" },
            new() { Id = 2, Title = "Task 2" }
        };
        _mockRepo.Setup(r => r.GetTodosAsync(1)).ReturnsAsync(tasks);

        var result = await _service.GetTodosAsync(1);

        result.Should().BeEquivalentTo(tasks);
        _mockRepo.Verify(r => r.GetTodosAsync(1), Times.Once);
    }

    [Fact]
    public async Task GetTodoAsync_ShouldReturnTask_WhenLinked()
    {
        var task = new TaskItem { Id = 5, Title = "Task 5" };
        _mockRepo.Setup(r => r.GetTodoAsync(1, 5)).ReturnsAsync(task);

        var result = await _service.GetTodoAsync(1, 5);

        result.Should().BeEquivalentTo(task);
    }

    [Fact]
    public async Task GetTodoAsync_ShouldReturnNull_WhenNotLinked()
    {
        _mockRepo.Setup(r => r.GetTodoAsync(1, 999)).ReturnsAsync((TaskItem?)null);

        var result = await _service.GetTodoAsync(1, 999);

        result.Should().BeNull();
    }

    [Fact]
    public async Task AddTodoAsync_ShouldCallRepositoryAddTodo()
    {
        _mockRepo.Setup(r => r.AddTodoAsync(1, 5)).Returns(Task.CompletedTask);

        await _service.AddTodoAsync(1, 5);

        _mockRepo.Verify(r => r.AddTodoAsync(1, 5), Times.Once);
    }

    [Fact]
    public async Task RemoveTodoAsync_ShouldCallRepositoryRemoveTodo()
    {
        _mockRepo.Setup(r => r.RemoveTodoAsync(1, 5)).Returns(Task.CompletedTask);

        await _service.RemoveTodoAsync(1, 5);

        _mockRepo.Verify(r => r.RemoveTodoAsync(1, 5), Times.Once);
    }
}
