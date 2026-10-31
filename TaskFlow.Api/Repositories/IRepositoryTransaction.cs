namespace TaskFlow.Api.Repositories;

/// <summary>
/// A unit of work spanning several repository calls on the same scoped context. Disposing without
/// calling <see cref="CommitAsync"/> rolls everything back.
/// </summary>
public interface IRepositoryTransaction : IAsyncDisposable
{
    Task CommitAsync(CancellationToken cancellationToken = default);
}
