using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Tests.Validators;

public class GoalValidatorTests
{
    private readonly GoalValidator _validator = new();

    [Theory]
    [InlineData(100, 200, true)]
    [InlineData(101, 200, false)]
    [InlineData(100, 201, false)]
    public async Task Validate_ShouldCapTitleAndParkedReason(int titleLength, int reasonLength, bool valid)
    {
        var goal = new Goal
        {
            Title = new string('a', titleLength),
            Status = GoalStatus.Parked,
            ParkedReason = new string('b', reasonLength),
        };

        var result = await _validator.ValidateAsync(goal, TestContext.Current.CancellationToken);

        Assert.Equal(valid, result.IsValid);
    }

    [Fact]
    public async Task Validate_ShouldRejectAStatusOutsideTheEnum()
    {
        // The JSON converter accepts integers, so an undefined value can reach the model.
        var result = await _validator.ValidateAsync(
            new Goal { Title = "g", Status = (GoalStatus)9 }, TestContext.Current.CancellationToken);

        Assert.Contains(result.Errors, e => e.PropertyName == "Status");
    }
}
