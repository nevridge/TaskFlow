using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class NoteValidatorTests
{
    private readonly NoteValidator _validator;

    public NoteValidatorTests()
    {
        _validator = new NoteValidator();
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenNoteIsValid()
    {
        var note = new Note { Content = "This is a valid note.", TaskItemId = 1 };

        var result = await _validator.ValidateAsync(note);

        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenContentIsEmpty()
    {
        var note = new Note { Content = string.Empty, TaskItemId = 1 };

        var result = await _validator.ValidateAsync(note);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e =>
            e.PropertyName == "Content" &&
            e.ErrorMessage == "Content is required.");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenContentExceedsMaxLength()
    {
        var note = new Note { Content = new string('a', 2001), TaskItemId = 1 };

        var result = await _validator.ValidateAsync(note);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e =>
            e.PropertyName == "Content" &&
            e.ErrorMessage == "Content must not exceed 2000 characters.");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenContentIsExactly2000Characters()
    {
        var note = new Note { Content = new string('a', 2000), TaskItemId = 1 };

        var result = await _validator.ValidateAsync(note);

        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }
}
