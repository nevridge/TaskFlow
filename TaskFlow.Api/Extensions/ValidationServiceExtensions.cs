using FluentValidation;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Extensions;

/// <summary>
/// Extension methods for configuring validation services
/// </summary>
public static class ValidationServiceExtensions
{
    /// <summary>
    /// Adds FluentValidation validators to the service collection
    /// </summary>
    /// <param name="services">The service collection</param>
    /// <returns>The service collection for chaining</returns>
    public static IServiceCollection AddValidation(this IServiceCollection services)
    {
        // Registers all AbstractValidator<T> types found in the assembly containing TaskItemValidator, including any future validators.
        services.AddValidatorsFromAssemblyContaining<TaskItemValidator>();

        return services;
    }
}
