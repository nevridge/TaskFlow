# TaskFlow.Api.Tests

Comprehensive unit test suite for TaskFlow.Api using xUnit (built-in `Assert.*` assertions) and Moq.

## Test Coverage

### Business Logic Coverage: 100% ✅

All critical business logic components have 100% test coverage:

| Component | Coverage | Test Count |
|-----------|----------|------------|
| TaskItemsController | 100% | 12 tests |
| TaskService | 100% | 9 tests |
| TaskRepository | 100% | 12 tests |
| TaskItemValidator | 100% | 10 tests |
| Models & DTOs | 100% | N/A |
| HealthCheckResponseWriter | 77.4% | 5 tests |

**Total Tests:** 47 tests, all passing ✅

### Overall Coverage: 52.3%

The overall coverage includes infrastructure code (Program.cs, Migrations, Middleware) which are not business logic.

## Running Tests

### Run all tests
```bash
dotnet test
```

### Run tests with coverage
```bash
dotnet test --project TaskFlow.Api.Tests --coverlet --coverlet-output-format cobertura
```

### Generate coverage report
```bash
dotnet tool install -g dotnet-reportgenerator-globaltool
reportgenerator -reports:"**/TestResults/coverage.cobertura*.xml" -targetdir:"coveragereport" -reporttypes:"Html;TextSummary"
```

## Test Structure

Tests follow the Arrange-Act-Assert (AAA) pattern and are organized by component:

```
TaskFlow.Api.Tests/
├── Controllers/
│   └── TaskItemsControllerTests.cs
├── Services/
│   └── TaskServiceTests.cs
├── Repositories/
│   └── TaskRepositoryTests.cs
├── Validators/
│   └── TaskItemValidatorTests.cs
└── HealthChecks/
    └── HealthCheckResponseWriterTests.cs
```

## Test Highlights

### Controller Tests
- Tests all HTTP endpoints (GET, POST, PUT, DELETE)
- Validates request/response handling
- Tests validation logic and error responses
- Covers edge cases (null values, not found scenarios)

### Service Tests
- Tests all business logic methods
- Validates correct repository interactions
- Tests edge cases and error handling
- Uses mocks to isolate service logic

### Repository Tests
- Tests all CRUD operations
- Uses in-memory database for realistic testing
- Validates data persistence
- Tests edge cases (empty collections, null values)

### Validator Tests
- Tests all validation rules
- Validates success cases
- Tests all failure scenarios
- Tests boundary conditions (max length, empty values)

## Dependencies

- **xUnit** - Test framework
- **Moq** - Mocking framework
- **xUnit `Assert.*`** - Built-in assertions (no separate assertion library)
- **Microsoft.EntityFrameworkCore.InMemory** - In-memory database for testing
- **Coverlet** - Code coverage tool

## Best Practices

All tests follow industry best practices:

1. **Arrange-Act-Assert** structure for clarity
2. **Meaningful test names** describing what is being tested
3. **Test isolation** - tests don't depend on each other
4. **Edge case coverage** - null values, empty collections, boundary conditions
5. **Mocking external dependencies** - services, repositories, validators
6. **In-memory database** for repository tests (realistic without external dependencies)
7. **Clear assertions** using xUnit `Assert.*`

## CI Integration

Tests are automatically run on every push and pull request via GitHub Actions. The CI pipeline:

1. Builds the solution
2. Runs all tests
3. Generates code coverage report
4. Displays coverage summary

See `.github/workflows/ci.yml` for CI configuration.
