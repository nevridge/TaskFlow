using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

/// <summary>
/// Real SQLite (the InMemory provider has no transactions or NOCASE collation), with a fresh context per
/// simulated request so that later reads see only what was committed.
/// </summary>
public sealed class AreaRepositoryTests : IDisposable
{
    private readonly SqliteConnection _connection;

    public AreaRepositoryTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        using var context = NewContext();
        context.Database.EnsureCreated();
    }

    public void Dispose() => _connection.Dispose();

    private TaskDbContext NewContext(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<TaskDbContext>()
            .UseSqlite(_connection)
            .AddInterceptors(interceptors)
            .Options);

    private async Task<int> AddAreaAsync(string name)
    {
        await using var context = NewContext();
        return (await new AreaRepository(context).AddAsync(new Area { Name = name })).Id;
    }

    /// <summary>Seeds an active project with one task and an archived project, both in the area.</summary>
    private async Task SeedProjectsAsync(int areaId)
    {
        await using var context = NewContext();
        var active = new Project { Name = "Active", AreaId = areaId };
        active.Tasks.Add(new TaskItem { Title = "T" });
        context.Projects.AddRange(active, new Project { Name = "Archived", IsArchived = true, AreaId = areaId });
        await context.SaveChangesAsync();
    }

    private async Task<List<Area>> GetAreasAsync()
    {
        await using var context = NewContext();
        return (await new AreaRepository(context).GetAllAsync()).ToList();
    }

    private async Task<DeleteAreaResult> DeleteAsync(int id, int? moveToAreaId = null, string? newAreaName = null, bool noArea = false)
    {
        await using var context = NewContext();
        return await new AreaRepository(context).DeleteAsync(id, moveToAreaId, newAreaName, noArea);
    }

    private async Task AssertProjectsInAsync(int? areaId)
    {
        await using var context = NewContext();
        var projects = await context.Projects.AsNoTracking().Include(p => p.Tasks).OrderBy(p => p.Name).ToListAsync();
        Assert.Equal(["Active", "Archived"], projects.Select(p => p.Name));
        Assert.All(projects, p => Assert.Equal(areaId, p.AreaId));
        Assert.Equal("T", Assert.Single(projects[0].Tasks).Title);
    }

    [Fact]
    public async Task AddAsync_ShouldAppendInDisplayOrder_AndStayLastAfterADelete()
    {
        var first = await AddAreaAsync("Zulu");
        var second = await AddAreaAsync("Alpha");
        await AddAreaAsync("Mike");
        Assert.Equal([0, 1, 2], (await GetAreasAsync()).Select(a => a.DisplayOrder));

        // Leaves a gap at 0 and 1; a count-based order would collide with Mike.
        await DeleteAsync(first);
        await DeleteAsync(second);
        await AddAreaAsync("Bravo");

        var areas = await GetAreasAsync();
        Assert.Equal(["Mike", "Bravo"], areas.Select(a => a.Name));
        Assert.Equal([2, 3], areas.Select(a => a.DisplayOrder));
    }

    [Fact]
    public async Task GetAllAsync_ShouldIncludeArchivedProjects()
    {
        var area = await AddAreaAsync("Work");
        await SeedProjectsAsync(area);

        Assert.Equal(2, Assert.Single(await GetAreasAsync()).Projects.Count);
    }

    [Fact]
    public async Task UpdateAsync_ShouldRename_SetUpdatedAt_AndKeepProjects()
    {
        var id = await AddAreaAsync("Work");
        await SeedProjectsAsync(id);

        await using (var context = NewContext())
        {
            var repo = new AreaRepository(context);
            var area = await repo.GetByIdAsync(id);
            area!.Name = "Office";
            await repo.UpdateAsync(area);
        }

        var saved = Assert.Single(await GetAreasAsync());
        Assert.Equal("Office", saved.Name);
        Assert.NotNull(saved.UpdatedAt);
        await AssertProjectsInAsync(id);
    }

    [Fact]
    public async Task ReorderAsync_ShouldPersistTheNewOrder()
    {
        var a = await AddAreaAsync("A");
        var b = await AddAreaAsync("B");
        var c = await AddAreaAsync("C");

        await using (var context = NewContext())
        {
            Assert.True(await new AreaRepository(context).ReorderAsync([c, a, b]));
        }

        Assert.Equal(["C", "A", "B"], (await GetAreasAsync()).Select(x => x.Name));
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("repeated")]
    [InlineData("unknown")]
    [InlineData("extra")]
    public async Task ReorderAsync_ShouldRejectAListThatIsNotExactlyTheCurrentIds(string problem)
    {
        var a = await AddAreaAsync("A");
        var b = await AddAreaAsync("B");
        int[] ids = problem switch
        {
            "missing" => [b],
            "repeated" => [b, b],
            "unknown" => [b, 999],
            _ => [b, a, 999],
        };

        await using (var context = NewContext())
        {
            Assert.False(await new AreaRepository(context).ReorderAsync(ids));
        }

        var areas = await GetAreasAsync();
        Assert.Equal(["A", "B"], areas.Select(x => x.Name));
        Assert.Equal([0, 1], areas.Select(x => x.DisplayOrder));
    }

    [Fact]
    public async Task DeleteAsync_ShouldDeleteAnEmptyArea()
    {
        var id = await AddAreaAsync("Work");

        Assert.Equal(DeleteAreaResult.Success, await DeleteAsync(id));

        Assert.Empty(await GetAreasAsync());
    }

    [Fact]
    public async Task DeleteAsync_ShouldReturnNotFound_ForAnUnknownArea()
    {
        Assert.Equal(DeleteAreaResult.NotFound, await DeleteAsync(999, noArea: true));
    }

    [Fact]
    public async Task DeleteAsync_ShouldMoveAllProjectsToTheTargetArea()
    {
        var source = await AddAreaAsync("Work");
        var target = await AddAreaAsync("Home");
        await SeedProjectsAsync(source);

        Assert.Equal(DeleteAreaResult.Success, await DeleteAsync(source, moveToAreaId: target));

        Assert.Equal(target, Assert.Single(await GetAreasAsync()).Id);
        await AssertProjectsInAsync(target);
        await using var context = NewContext();
        Assert.All(await context.Projects.ToListAsync(), p => Assert.NotNull(p.UpdatedAt));
    }

    [Fact]
    public async Task DeleteAsync_ShouldMoveAllProjectsToANewAreaPlacedLast()
    {
        var source = await AddAreaAsync("Work");
        await AddAreaAsync("Home");
        await SeedProjectsAsync(source);

        Assert.Equal(DeleteAreaResult.Success, await DeleteAsync(source, newAreaName: "Office"));

        var areas = await GetAreasAsync();
        Assert.Equal(["Home", "Office"], areas.Select(a => a.Name));
        await AssertProjectsInAsync(areas[1].Id);
    }

    [Fact]
    public async Task DeleteAsync_ShouldLeaveAllProjectsWithoutAnArea()
    {
        var source = await AddAreaAsync("Work");
        await SeedProjectsAsync(source);

        Assert.Equal(DeleteAreaResult.Success, await DeleteAsync(source, noArea: true));

        Assert.Empty(await GetAreasAsync());
        await AssertProjectsInAsync(null);
    }

    [Theory]
    [InlineData(null, null, DeleteAreaResult.HasProjects)]
    [InlineData(999, null, DeleteAreaResult.TargetNotFound)]
    [InlineData(null, "HOME", DeleteAreaResult.NameTaken)]
    [InlineData(null, "work", DeleteAreaResult.NameTaken)]
    public async Task DeleteAsync_ShouldChangeNothing_WhenRefused(int? moveToAreaId, string? newAreaName, DeleteAreaResult expected)
    {
        var source = await AddAreaAsync("Work");
        await AddAreaAsync("Home");
        await SeedProjectsAsync(source);

        Assert.Equal(expected, await DeleteAsync(source, moveToAreaId, newAreaName));

        Assert.Equal(["Work", "Home"], (await GetAreasAsync()).Select(a => a.Name));
        await AssertProjectsInAsync(source);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    public async Task DeleteAsync_ShouldRollBackEverything_WhenALaterSaveFails(int failingSave)
    {
        var source = await AddAreaAsync("Work");
        await SeedProjectsAsync(source);

        // Save 1 creates the new area, save 2 moves the projects, save 3 removes the old area.
        await using (var context = NewContext(new FailOnSave(failingSave)))
        {
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => new AreaRepository(context).DeleteAsync(source, null, "Office", false));
        }

        Assert.Equal(source, Assert.Single(await GetAreasAsync()).Id);
        await AssertProjectsInAsync(source);
    }

    [Fact]
    public async Task Name_ShouldBeUniqueCaseInsensitively()
    {
        var id = await AddAreaAsync("Personal");

        await using var context = NewContext();
        var repo = new AreaRepository(context);
        Assert.True(await repo.NameExistsAsync("PERSONAL"));
        Assert.False(await repo.NameExistsAsync("PERSONAL", id));
        await Assert.ThrowsAsync<DbUpdateException>(() => repo.AddAsync(new Area { Name = "PERSONAL" }));
    }

    private sealed class FailOnSave(int failingSave) : SaveChangesInterceptor
    {
        private int _saves;

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (++_saves == failingSave)
            {
                throw new InvalidOperationException("Simulated save failure.");
            }

            return ValueTask.FromResult(result);
        }
    }
}
