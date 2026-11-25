using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Real-stack tests for <see cref="AreasController"/>: real repository and validator on real SQLite (name
/// uniqueness depends on its NOCASE collation), one fresh <see cref="TaskDbContext"/> per simulated request.
/// </summary>
public sealed class AreasControllerV1Tests : IDisposable
{
    private const string DuplicateMessage = "An area with this name already exists.";
    private readonly SqliteConnection _connection;

    public AreasControllerV1Tests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        using var context = NewContext();
        context.Database.EnsureCreated();
    }

    public void Dispose() => _connection.Dispose();

    private TaskDbContext NewContext() => new(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options);

    private async Task<T> RequestAsync<T>(Func<AreasController, Task<T>> request)
    {
        await using var context = NewContext();
        return await request(new AreasController(new AreaRepository(context), new AreaValidator()));
    }

    private async Task<AreaResponseDto> CreateAsync(string name)
    {
        var result = await RequestAsync(c => c.Create(new CreateAreaDto { Name = name }));
        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        return Assert.IsType<AreaResponseDto>(created.Value);
    }

    private async Task AddProjectAsync(int areaId)
    {
        await using var context = NewContext();
        context.Projects.Add(new Project { Name = "P", AreaId = areaId });
        await context.SaveChangesAsync();
    }

    private async Task<List<string>> NamesAsync()
    {
        await using var context = NewContext();
        return await context.Areas.AsNoTracking().OrderBy(a => a.DisplayOrder).Select(a => a.Name).ToListAsync();
    }

    private async Task<int?> ProjectAreaIdAsync()
    {
        await using var context = NewContext();
        return (await context.Projects.AsNoTracking().SingleAsync()).AreaId;
    }

    private static string? Message(object? value) =>
        value?.GetType().GetProperty("message")?.GetValue(value) as string;

    [Fact]
    public async Task Create_ShouldTrimName_AndPointAtTheNewArea()
    {
        var result = await RequestAsync(c => c.Create(new CreateAreaDto { Name = "  Personal  " }));

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var dto = Assert.IsType<AreaResponseDto>(created.Value);
        Assert.Equal("GetAreaV1", created.RouteName);
        Assert.Equal(dto.Id, created.RouteValues!["id"]);
        Assert.Equal("Personal", dto.Name);
        Assert.Equal(0, dto.ProjectCount);
        Assert.NotEqual(default, dto.CreatedAt);
    }

    [Theory]
    [InlineData(" Personal ")]
    [InlineData("PERSONAL")]
    public async Task CreateAndRename_ShouldReturnConflict_ForATakenName(string name)
    {
        await CreateAsync("Personal");
        var other = await CreateAsync("Work");

        var create = await RequestAsync(c => c.Create(new CreateAreaDto { Name = name }));
        var rename = await RequestAsync(c => c.Update(other.Id, new UpdateAreaDto { Name = name }));

        Assert.Equal(DuplicateMessage, Message(Assert.IsType<ConflictObjectResult>(create.Result).Value));
        Assert.Equal(DuplicateMessage, Message(Assert.IsType<ConflictObjectResult>(rename.Result).Value));
        Assert.Equal(["Personal", "Work"], await NamesAsync());
    }

    [Fact]
    public async Task Update_ShouldAllowRecasingItsOwnName_AndReportProjectCount()
    {
        var area = await CreateAsync("Personal");
        await AddProjectAsync(area.Id);

        var result = await RequestAsync(c => c.Update(area.Id, new UpdateAreaDto { Name = " PERSONAL " }));

        var dto = Assert.IsType<AreaResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("PERSONAL", dto.Name);
        Assert.Equal(1, dto.ProjectCount);
        Assert.Equal(["PERSONAL"], await NamesAsync());
    }

    [Fact]
    public async Task CreateAndRename_ShouldRejectABlankName()
    {
        var area = await CreateAsync("Work");

        var create = await RequestAsync(c => c.Create(new CreateAreaDto { Name = "   " }));
        var rename = await RequestAsync(c => c.Update(area.Id, new UpdateAreaDto { Name = "   " }));

        Assert.IsType<BadRequestObjectResult>(create.Result);
        Assert.IsType<BadRequestObjectResult>(rename.Result);
        Assert.Equal(["Work"], await NamesAsync());
    }

    [Fact]
    public async Task GetRenameAndDelete_ShouldReturnNotFound_ForAnUnknownId()
    {
        var get = await RequestAsync(c => c.Get(999));
        var rename = await RequestAsync(c => c.Update(999, new UpdateAreaDto { Name = "X" }));
        var delete = await RequestAsync(c => c.Delete(999));

        Assert.IsType<NotFoundResult>(get.Result);
        Assert.IsType<NotFoundResult>(rename.Result);
        Assert.IsType<NotFoundResult>(delete);
    }

    [Fact]
    public async Task Reorder_ShouldReturnTheAreasInTheirNewOrder()
    {
        var a = await CreateAsync("A");
        var b = await CreateAsync("B");

        var result = await RequestAsync(c => c.Reorder(new ReorderAreasDto { AreaIds = [b.Id, a.Id] }));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var areas = Assert.IsAssignableFrom<IEnumerable<AreaResponseDto>>(ok.Value).ToList();
        Assert.Equal(["B", "A"], areas.Select(x => x.Name));
        Assert.Equal([0, 1], areas.Select(x => x.DisplayOrder));
    }

    [Fact]
    public async Task Reorder_ShouldReturnBadRequest_ForAnIncompleteList()
    {
        var a = await CreateAsync("A");
        await CreateAsync("B");

        var result = await RequestAsync(c => c.Reorder(new ReorderAreasDto { AreaIds = [a.Id] }));

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("The list must contain every area id exactly once.", Message(bad.Value));
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_ForAnEmptyArea()
    {
        var area = await CreateAsync("Work");

        Assert.IsType<NoContentResult>(await RequestAsync(c => c.Delete(area.Id)));
        Assert.Empty(await NamesAsync());
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("   ", false)]
    public async Task Delete_ShouldReturnConflict_WhenProjectsHaveNoDestination(string? newAreaName, bool noArea)
    {
        var area = await CreateAsync("Work");
        await AddProjectAsync(area.Id);

        var result = await RequestAsync(c => c.Delete(area.Id, newAreaName: newAreaName, noArea: noArea));

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        Assert.Equal(
            "This area has projects. Choose where they go: moveToAreaId, newAreaName or noArea=true.",
            Message(conflict.Value));
        Assert.Equal(["Work"], await NamesAsync());
    }

    [Fact]
    public async Task Delete_ShouldReportAMissingTargetAndATakenNewName()
    {
        var area = await CreateAsync("Work");
        await CreateAsync("Home");
        await AddProjectAsync(area.Id);

        var missing = await RequestAsync(c => c.Delete(area.Id, moveToAreaId: 999));
        var taken = await RequestAsync(c => c.Delete(area.Id, newAreaName: " home "));

        Assert.Equal("Target area not found.", Message(Assert.IsType<BadRequestObjectResult>(missing).Value));
        Assert.Equal(DuplicateMessage, Message(Assert.IsType<ConflictObjectResult>(taken).Value));
        Assert.Equal(["Work", "Home"], await NamesAsync());
    }

    [Theory]
    [InlineData(true, "Office", false)]
    [InlineData(true, null, true)]
    [InlineData(false, "Office", true)]
    public async Task Delete_ShouldReturnBadRequest_ForMoreThanOneChoice(bool move, string? newAreaName, bool noArea)
    {
        var area = await CreateAsync("Work");
        var target = await CreateAsync("Home");
        await AddProjectAsync(area.Id);

        var result = await RequestAsync(c => c.Delete(area.Id, move ? target.Id : null, newAreaName, noArea));

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(["Work", "Home"], await NamesAsync());
        Assert.Equal(area.Id, await ProjectAreaIdAsync());
    }

    [Fact]
    public async Task Delete_ShouldReturnBadRequest_WhenTheTargetIsTheAreaItself()
    {
        var area = await CreateAsync("Work");
        await AddProjectAsync(area.Id);

        var result = await RequestAsync(c => c.Delete(area.Id, moveToAreaId: area.Id));

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(["Work"], await NamesAsync());
        Assert.Equal(area.Id, await ProjectAreaIdAsync());
    }

    [Fact]
    public async Task Delete_ShouldReturnValidationErrors_ForATooLongNewName()
    {
        var area = await CreateAsync("Work");

        var result = await RequestAsync(c => c.Delete(area.Id, newAreaName: new string('a', 101)));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var errors = Assert.IsAssignableFrom<IEnumerable<ValidationFailure>>(bad.Value);
        Assert.Equal("Name must not exceed 100 characters.", Assert.Single(errors).ErrorMessage);
        Assert.Equal(["Work"], await NamesAsync());
    }

    [Fact]
    public async Task Delete_ShouldUseTheProjectsPresentAtRequestTime_NotAnEarlierRead()
    {
        var area = await CreateAsync("Work");
        var target = await CreateAsync("Home");
        var seen = await RequestAsync(c => c.Get(area.Id));
        Assert.Equal(0, Assert.IsType<AreaResponseDto>(Assert.IsType<OkObjectResult>(seen.Result).Value).ProjectCount);

        // Added after the caller saw an empty area.
        await AddProjectAsync(area.Id);

        Assert.IsType<ConflictObjectResult>(await RequestAsync(c => c.Delete(area.Id)));
        Assert.IsType<NoContentResult>(await RequestAsync(c => c.Delete(area.Id, moveToAreaId: target.Id)));
        await using var context = NewContext();
        Assert.Equal(target.Id, (await context.Projects.AsNoTracking().SingleAsync()).AreaId);
    }

    [Fact]
    public async Task CreateAndRename_ShouldMeasureTheNameLengthAfterTrimming()
    {
        var longest = new string('a', 100);
        var renamed = new string('b', 100);

        var created = await CreateAsync($"  {longest}  ");
        var rename = await RequestAsync(c => c.Update(created.Id, new UpdateAreaDto { Name = $"  {renamed}  " }));
        var tooLong = await RequestAsync(c => c.Create(new CreateAreaDto { Name = new string('c', 101) }));

        Assert.Equal(longest, created.Name);
        Assert.IsType<OkObjectResult>(rename.Result);
        Assert.IsType<BadRequestObjectResult>(tooLong.Result);
        Assert.Equal([renamed], await NamesAsync());
    }

    [Fact]
    public async Task Delete_ShouldCreateTheTrimmedNewName_EvenForAnEmptyArea()
    {
        var area = await CreateAsync("Work");

        var result = await RequestAsync(c => c.Delete(area.Id, newAreaName: "  Office  "));

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(["Office"], await NamesAsync());
    }
}
