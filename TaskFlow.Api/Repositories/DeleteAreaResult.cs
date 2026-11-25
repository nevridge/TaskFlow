namespace TaskFlow.Api.Repositories;

public enum DeleteAreaResult
{
    Success,
    NotFound,
    HasProjects,
    TargetNotFound,
    NameTaken,
}
