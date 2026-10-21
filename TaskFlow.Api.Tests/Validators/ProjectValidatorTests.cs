using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class ProjectValidatorTests
{
    private readonly ProjectValidator _validator = new();

    [Fact]
    public async Task Validate_ShouldPass_WhenProjectIsValid()
    {
        var result = await _validator.ValidateAsync(new Project { Name = "Alpha", Description = "Work" });

        Assert.True(result.IsValid);
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenNameIsEmpty()
    {
        var result = await _validator.ValidateAsync(new Project { Name = string.Empty });

        Assert.Contains(result.Errors, e => e.PropertyName == "Name" && e.ErrorMessage == "Name is required.");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenNameExceeds100Characters()
    {
        var result = await _validator.ValidateAsync(new Project { Name = new string('a', 101) });

        Assert.Contains(result.Errors, e => e.PropertyName == "Name" && e.ErrorMessage == "Name must not exceed 100 characters.");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenNameIsExactly100Characters()
    {
        var result = await _validator.ValidateAsync(new Project { Name = new string('a', 100) });

        Assert.True(result.IsValid);
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenDescriptionExceeds2000Characters()
    {
        var result = await _validator.ValidateAsync(new Project { Name = "Alpha", Description = new string('a', 2001) });

        Assert.Contains(result.Errors, e => e.PropertyName == "Description" && e.ErrorMessage == "Description must not exceed 2000 characters.");
    }
}

public class AssignProjectTaskDtoValidatorTests
{
    private readonly AssignProjectTaskDtoValidator _validator = new();

    [Fact]
    public async Task Validate_ShouldPass_WhenTaskItemIdIsPositive()
    {
        var result = await _validator.ValidateAsync(new AssignProjectTaskDto { TaskItemId = 1 });

        Assert.True(result.IsValid);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public async Task Validate_ShouldFail_WhenTaskItemIdIsNotPositive(int id)
    {
        var result = await _validator.ValidateAsync(new AssignProjectTaskDto { TaskItemId = id });

        Assert.Contains(result.Errors, e => e.PropertyName == "TaskItemId");
    }
}
