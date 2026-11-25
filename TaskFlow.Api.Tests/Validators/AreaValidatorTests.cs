using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class AreaValidatorTests
{
    private readonly AreaValidator _validator = new();

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Validate_ShouldFail_WhenNameIsBlank(string name)
    {
        var result = await _validator.ValidateAsync(new Area { Name = name }, TestContext.Current.CancellationToken);

        Assert.Contains(result.Errors, e => e.PropertyName == "Name" && e.ErrorMessage == "Name is required.");
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenNameExceeds100Characters()
    {
        var result = await _validator.ValidateAsync(new Area { Name = new string('a', 101) }, TestContext.Current.CancellationToken);

        Assert.Contains(result.Errors, e => e.PropertyName == "Name" && e.ErrorMessage == "Name must not exceed 100 characters.");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenNameIsExactly100Characters()
    {
        var result = await _validator.ValidateAsync(new Area { Name = new string('a', 100) }, TestContext.Current.CancellationToken);

        Assert.True(result.IsValid);
    }
}
