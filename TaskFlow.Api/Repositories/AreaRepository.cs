using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public class AreaRepository(TaskDbContext context) : IAreaRepository
{
    private readonly TaskDbContext _context = context;

    public async Task<IEnumerable<Area>> GetAllAsync() =>
        await _context.Areas
            .AsNoTracking()
            .Include(a => a.Projects)
            .OrderBy(a => a.DisplayOrder)
            .ThenBy(a => a.Id)
            .ToListAsync();

    public async Task<Area?> GetByIdAsync(int id) =>
        await _context.Areas
            .Include(a => a.Projects)
            .FirstOrDefaultAsync(a => a.Id == id);

    public async Task<Area?> GetByIdNoTrackingAsync(int id) =>
        // Read-only query: callers must not mutate or Update the result.
        await _context.Areas
            .AsNoTracking()
            .Include(a => a.Projects)
            .FirstOrDefaultAsync(a => a.Id == id);

    public async Task<bool> NameExistsAsync(string name, int? excludeAreaId = null) =>
        await _context.Areas.AnyAsync(a => a.Name == name && (excludeAreaId == null || a.Id != excludeAreaId));

    public async Task<Area> AddAsync(Area area)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();
        await AddLastAsync(area);
        await transaction.CommitAsync();
        return area;
    }

    public async Task UpdateAsync(Area area)
    {
        area.UpdatedAt = DateTime.UtcNow;

        // Tracked entities (loaded via GetByIdAsync) need no Update call because change detection
        // picks up their edits; Update is only required to attach a Detached entity.
        if (_context.Entry(area).State == EntityState.Detached)
        {
            _context.Areas.Update(area);
        }

        await _context.SaveChangesAsync();
    }

    public async Task<bool> ReorderAsync(IReadOnlyList<int> areaIds)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync();

        var areas = await _context.Areas.ToDictionaryAsync(a => a.Id);
        if (areaIds.Count != areas.Count
            || areaIds.Distinct().Count() != areaIds.Count
            || !areaIds.All(areas.ContainsKey))
        {
            return false;
        }

        for (var index = 0; index < areaIds.Count; index++)
        {
            areas[areaIds[index]].DisplayOrder = index;
        }

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return true;
    }

    public async Task<DeleteAreaResult> DeleteAsync(int id, int? moveToAreaId, string? newAreaName, bool noArea)
    {
        // Disposing without a commit rolls back, so every early return and exception leaves the data unchanged.
        await using var transaction = await _context.Database.BeginTransactionAsync();

        var area = await _context.Areas.FindAsync(id);
        if (area is null)
        {
            return DeleteAreaResult.NotFound;
        }

        // Read inside the transaction, so projects added since the caller last looked are included.
        var projects = await _context.Projects.Where(p => p.AreaId == id).ToListAsync();
        if (projects.Count > 0 && moveToAreaId is null && newAreaName is null && !noArea)
        {
            return DeleteAreaResult.HasProjects;
        }

        var targetId = moveToAreaId;
        if (moveToAreaId is not null && !await _context.Areas.AnyAsync(a => a.Id == moveToAreaId))
        {
            return DeleteAreaResult.TargetNotFound;
        }

        if (newAreaName is not null)
        {
            if (await NameExistsAsync(newAreaName))
            {
                return DeleteAreaResult.NameTaken;
            }

            var newArea = new Area { Name = newAreaName };
            await AddLastAsync(newArea);
            targetId = newArea.Id;
        }

        var now = DateTime.UtcNow;
        foreach (var project in projects)
        {
            project.AreaId = targetId;
            project.UpdatedAt = now;
        }

        await _context.SaveChangesAsync();

        _context.Areas.Remove(area);
        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return DeleteAreaResult.Success;
    }

    /// <summary>Saves the area after the current last one. The caller owns the transaction.</summary>
    private async Task AddLastAsync(Area area)
    {
        var lastOrder = await _context.Areas.MaxAsync(a => (int?)a.DisplayOrder);
        area.DisplayOrder = lastOrder + 1 ?? 0;
        area.CreatedAt = DateTime.UtcNow;
        _context.Areas.Add(area);
        await _context.SaveChangesAsync();
    }
}
