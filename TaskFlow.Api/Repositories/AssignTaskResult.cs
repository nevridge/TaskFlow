namespace TaskFlow.Api.Repositories;

public enum AssignTaskResult
{
    Success,
    ProjectNotFound,
    TaskNotFound,
    AlreadyAssigned,
}
