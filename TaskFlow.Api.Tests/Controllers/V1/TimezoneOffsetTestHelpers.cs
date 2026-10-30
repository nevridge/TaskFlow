using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;

namespace TaskFlow.Api.Tests.Controllers.V1;

internal static class TimezoneOffsetTestHelpers
{
    public const string OffsetMessage = "TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).";

    public static void AssertOffsetBadRequest(IActionResult? actionResult)
    {
        var badRequest = Assert.IsType<BadRequestObjectResult>(actionResult);
        var errors = Assert.IsAssignableFrom<IEnumerable<ValidationFailure>>(badRequest.Value);
        Assert.Single(errors, e => e.PropertyName == "TimezoneOffsetMinutes" && e.ErrorMessage == OffsetMessage);
    }
}
