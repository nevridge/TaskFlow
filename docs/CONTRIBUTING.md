# Contributing to TaskFlow.Api

Thank you for your interest in contributing to TaskFlow.Api! This guide outlines the development workflow, coding standards, and contribution process.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Documentation Philosophy](#documentation-philosophy)

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (for containerized testing)
- [Git](https://git-scm.com/)
- A code editor (Visual Studio, VS Code, or Rider)

### Setting Up Your Development Environment

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/TaskFlow.Api.git
   cd TaskFlow.Api
   ```

2. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Restore dependencies:**
   ```bash
   dotnet restore
   ```

4. **Run the application:**
   ```bash
   dotnet run --project TaskFlow.Api
   ```

5. **Run tests:**
   ```bash
   dotnet test
   ```

## Development Workflow

### Branch Strategy

- **`main`** - Production-ready code
- **`feature/*`** - New features
- **`bugfix/*`** - Bug fixes
- **`docs/*`** - Documentation updates

### Making Changes

1. **Create a feature branch** from `main`
2. **Make your changes** with clear, focused commits
3. **Write tests** for new functionality
4. **Run tests** and ensure they pass
5. **Check code formatting** with `dotnet format`
6. **Update documentation** if needed
7. **Submit a pull request**

### Commit Message Convention

Use clear, descriptive commit messages:

```
<type>: <subject>

<body> (optional)

<footer> (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat: Add pagination support to TaskItems endpoint

Implements page and pageSize query parameters for the GET endpoint.
Includes tests and documentation updates.
```

```
fix: Resolve database connection timeout in health checks

Increases health check timeout from 5s to 10s to prevent
false negatives during high load.
```

### Running the Development Server

**With hot reload:**
```bash
dotnet watch run --project TaskFlow.Api
```

The application will automatically reload when you save changes.

**With Docker:**
```bash
docker compose up
```

Access the API at `http://localhost:8080` with Scalar UI (`http://localhost:8080/scalar/v1`).

## Coding Standards

### C# Code Style

TaskFlow.Api follows standard .NET coding conventions.

**Key principles:**
- Use meaningful names for variables, methods, and classes
- Keep methods small and focused (single responsibility)
- Prefer async/await for I/O operations
- Use dependency injection for service dependencies
- Avoid hardcoded values (use configuration)

**Formatting:**
```bash
# Check formatting
dotnet format --verify-no-changes

# Apply formatting
dotnet format
```

The CI pipeline will fail if code is not properly formatted.

### Service Registration Pattern

When adding new services, follow the Service Registration Pattern:

1. **Create extension class** in `Extensions/` folder:
   ```csharp
   namespace TaskFlow.Api.Extensions;

   public static class YourServiceExtensions
   {
       public static IServiceCollection AddYourServices(
           this IServiceCollection services,
           IConfiguration configuration)
       {
           // Register your services here
           services.AddScoped<IYourService, YourService>();
           
           return services;
       }
   }
   ```

2. **Register in Program.cs:**
   ```csharp
   builder.Services.AddYourServices(builder.Configuration);
   ```

This keeps `Program.cs` clean and services organized. See [Service Registration Pattern](SERVICE_REGISTRATION_PATTERN.md) for details.

### Repository Pattern

New data access should use the repository pattern:

1. **Define interface:**
   ```csharp
   public interface IYourRepository
   {
       Task<YourEntity> GetByIdAsync(int id);
       Task<IEnumerable<YourEntity>> GetAllAsync();
       Task<YourEntity> AddAsync(YourEntity entity);
       Task UpdateAsync(YourEntity entity);
       Task DeleteAsync(int id);
   }
   ```

2. **Implement repository:**
   ```csharp
   public class YourRepository : IYourRepository
   {
       private readonly TaskDbContext _context;
       
       public YourRepository(TaskDbContext context)
       {
           _context = context;
       }
       
       // Implementation...
   }
   ```

3. **Register in DI:**
   ```csharp
   services.AddScoped<IYourRepository, YourRepository>();
   ```

### DTOs and Validation

- Use separate DTOs for create, update, and response operations
- Implement FluentValidation validators for input validation
- Keep domain models separate from API contracts

**Example validator:**
```csharp
public class YourDtoValidator : AbstractValidator<YourDto>
{
    public YourDtoValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty()
            .WithMessage("Name is required")
            .MaximumLength(100);
    }
}
```

### Async/Await

Always use async/await for I/O operations:

```csharp
// ✅ Good
public async Task<TaskItem> GetTaskAsync(int id)
{
    return await _repository.GetByIdAsync(id);
}

// ❌ Bad
public TaskItem GetTask(int id)
{
    return _repository.GetByIdAsync(id).Result;
}
```

### Error Handling

- Use appropriate HTTP status codes
- Return problem details for errors (RFC 7807)
- Log exceptions with context

```csharp
try
{
    // Operation
}
catch (NotFoundException ex)
{
    _logger.LogWarning(ex, "Resource not found: {ResourceId}", id);
    return NotFound();
}
catch (Exception ex)
{
    _logger.LogError(ex, "Unexpected error processing request");
    return StatusCode(500, "An unexpected error occurred");
}
```

## Testing Requirements

### Writing Tests

All new features must include tests. TaskFlow.Api uses xUnit for testing.

**Test structure:**
```
TaskFlow.Api.Tests/
├── Controllers/        # Controller tests
├── Repositories/       # Repository tests
├── Validators/         # Validation tests
├── HealthChecks/       # Health check tests
└── Extensions/         # DI registration tests
```

**Example unit test:**
```csharp
public class TaskItemsControllerV1Tests
{
    [Fact]
    public async Task GetById_ReturnsNotFound_WhenTaskDoesNotExist()
    {
        // Arrange
        var mockRepo = new Mock<ITaskRepository>();
        mockRepo.Setup(r => r.GetByIdAsync(1))
                .ReturnsAsync((TaskItem?)null);

        var controller = new TaskItemsController(mockRepo.Object);

        // Act
        var result = await controller.GetById(1);

        // Assert
        result.Result.Should().BeOfType<NotFoundResult>();
    }
}
```

### Running Tests

```bash
# Run all tests
dotnet test

# Run tests with coverage
dotnet test /p:CollectCoverage=true

# Run specific test
dotnet test --filter "FullyQualifiedName~TaskServiceTests.GetByIdAsync"

# Watch mode (reruns on changes)
dotnet watch test --project TaskFlow.Api.Tests
```

### Code Coverage

- Minimum **75% total line coverage** required — PRs are blocked if coverage falls below this threshold
- CI pipeline enforces coverage threshold automatically
- Coverage reports generated for each PR

The following types are excluded from coverage calculations (matching CI):

| Exclusion | Reason |
|-----------|--------|
| `[xunit.*]*` | xUnit test framework internals |
| `TaskFlow.Api.Program` | Application entry point |
| `TaskFlow.Api.Migrations.*` | EF Core auto-generated migrations |
| `TaskFlow.Api.Middleware.*` | ASP.NET Core middleware pipeline |
| `Microsoft.AspNetCore.OpenApi.*` | OpenAPI/Swagger generated code |
| `System.Runtime.CompilerServices.*` | Compiler-generated code |
| `TaskFlow.Api.DTOs.*` | Plain data transfer objects |

**Check coverage locally (mirrors CI enforcement):**
```bash
dotnet test --configuration Release \
  /p:CollectCoverage=true \
  /p:CoverletOutputFormat=cobertura \
  /p:CoverletOutput=./TestResults/coverage.cobertura.xml \
  /p:Exclude="[xunit.*]*,[TaskFlow.Api]TaskFlow.Api.Program,[TaskFlow.Api]TaskFlow.Api.Migrations.*,[TaskFlow.Api]TaskFlow.Api.Middleware.*,[TaskFlow.Api]Microsoft.AspNetCore.OpenApi.*,[TaskFlow.Api]System.Runtime.CompilerServices.*,[TaskFlow.Api]TaskFlow.Api.DTOs.*" \
  /p:Threshold=75 \
  /p:ThresholdType=line \
  /p:ThresholdStat=total
```

### Extension Registration Tests

DI registration tests should:
- Use an in-memory `ServiceCollection`
- Verify services can be resolved from the built provider
- Cover all registered interfaces and implementations
- Clean up after each test

## Pull Request Process

### Before Submitting

1. **Ensure tests pass:**
   ```bash
   dotnet test
   ```

2. **Check code formatting:**
   ```bash
   dotnet format --verify-no-changes
   ```

3. **Verify build succeeds:**
   ```bash
   dotnet build -c Release
   ```

4. **Update documentation** if you've changed:
   - API endpoints
   - Configuration options
   - Setup procedures
   - Architecture/patterns

### Submitting a Pull Request

1. **Push your branch** to your fork
2. **Create a pull request** to the `main` branch
3. **Fill out the PR template** with:
   - Description of changes
   - Motivation and context
   - Related issues
   - Testing performed
   - Screenshots (if UI changes)

4. **Wait for CI checks** to complete
5. **Address review feedback** promptly
6. **Squash commits** if requested before merge

### PR Requirements

Your pull request must:
- ✅ Pass all CI checks (build, test, lint, security)
- ✅ Meet code coverage requirements (75%+)
- ✅ Follow coding standards
- ✅ Include tests for new functionality
- ✅ Update relevant documentation
- ✅ Have a clear, descriptive title and description
- ✅ Reference related issues (e.g., "Closes #123")

### Code Review

Expect feedback on:
- **Code quality:** Readability, maintainability, performance
- **Testing:** Coverage, test quality, edge cases
- **Security:** Potential vulnerabilities
- **Architecture:** Consistency with existing patterns
- **Documentation:** Clarity and completeness

## Documentation Philosophy

TaskFlow.Api follows an audience-focused documentation approach:

### Audience Priorities

**Developers (Primary):**
- Can get started quickly (<5 minutes)
- Understand how to contribute
- Find examples and troubleshooting help
- Navigate architecture and patterns

**Employers/Reviewers (Secondary):**
- Can assess code quality and skills quickly
- See evidence of best practices
- Understand architectural decisions
- Evaluate CI/CD and deployment patterns

### Documentation Structure

**README.md:**
- Project overview and key features
- Quick start instructions
- Technology stack
- Portfolio highlights
- Links to detailed documentation

**docs/ Directory:**
- Focused, comprehensive guides
- One topic per file
- Cross-referenced with clear navigation
- Examples and troubleshooting

### Writing Documentation

When updating documentation:

1. **Be concise** - Get to the point quickly
2. **Use examples** - Show, don't just tell
3. **Consider both audiences** - Developers and reviewers
4. **Keep it current** - Update docs with code changes
5. **Test instructions** - Verify setup steps actually work

### Documentation Files

| File | Purpose | Audience |
|------|---------|----------|
| `README.md` | Overview, quick start, highlights | Everyone |
| `GETTING_STARTED.md` | Detailed setup instructions | Developers |
| `ARCHITECTURE.md` | Design decisions, patterns | Developers, Reviewers |
| `DEPLOYMENT.md` | Docker, Portainer GitOps, CI/CD | DevOps, Developers |
| `API.md` | Endpoint reference | Developers, API Users |
| `CONTRIBUTING.md` | Development workflow | Contributors |
| `SECURITY_SCANNING.md` | CodeQL, Trivy setup | DevOps, Security |
| `LOGGING.md` | Serilog configuration | Developers, Ops |

## Additional Guidelines

### Database Migrations

When modifying entity models:

1. **Create migration:**
   ```bash
   dotnet ef migrations add YourMigrationName --project TaskFlow.Api
   ```

2. **Review generated migration** in `Migrations/`
3. **Test migration** locally:
   ```bash
   dotnet ef database update --project TaskFlow.Api
   ```

4. **Commit migration files** with your changes

### Configuration Changes

When adding configuration options:

1. **Add to `appsettings.json`** with default value
2. **Document the option** in README or relevant doc
3. **Support environment variable override**
4. **Add validation** if required value

### Breaking Changes

If your change breaks existing API contracts:

1. **Discuss in an issue first**
2. **Document the breaking change** clearly
3. **Provide migration guide** for users
4. **Consider API versioning** if appropriate

## Getting Help

- **Issues:** Check existing issues or create a new one
- **Discussions:** Use GitHub Discussions for questions
- **Documentation:** Review the docs/ directory
- **Code:** Read existing code for patterns and examples

## License

By contributing to TaskFlow.Api, you agree that your contributions will be subject to the same license as the project (see LICENSE file).

## Recognition

Contributors will be recognized in release notes and the project README.

Thank you for contributing to TaskFlow.Api! 🎉

---

[← Back to README](../README.md) | [Architecture](ARCHITECTURE.md) | [Getting Started →](GETTING_STARTED.md)
