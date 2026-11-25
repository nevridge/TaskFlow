using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

public interface IAreaRepository
{
    /// <summary>Returns all areas in display order with their projects loaded (used for project counts).</summary>
    Task<IEnumerable<Area>> GetAllAsync();
    Task<Area?> GetByIdAsync(int id);
    Task<Area?> GetByIdNoTrackingAsync(int id);
    Task<bool> NameExistsAsync(string name, int? excludeAreaId = null);

    /// <summary>Adds the area after the current last one.</summary>
    Task<Area> AddAsync(Area area);
    Task UpdateAsync(Area area);

    /// <summary>
    /// Sets each area's display order to its position in <paramref name="areaIds"/>. Returns false, writing
    /// nothing, unless the list contains every current area id exactly once.
    /// </summary>
    Task<bool> ReorderAsync(IReadOnlyList<int> areaIds);

    /// <summary>
    /// Deletes the area in one transaction, first moving its projects (archived included) according to the
    /// choice: an existing area, a new area, or no area. An area with projects needs a choice.
    /// </summary>
    Task<DeleteAreaResult> DeleteAsync(int id, int? moveToAreaId, string? newAreaName, bool noArea);
}
