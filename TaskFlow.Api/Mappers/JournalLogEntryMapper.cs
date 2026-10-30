using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Mappers;

/// <summary>
/// Single place that converts a <see cref="JournalLogEntry"/> into its response DTO.
/// </summary>
public static class JournalLogEntryMapper
{
    /// <summary>
    /// Maps a log entry to <see cref="JournalLogEntryResponseDto"/>. The <c>TaskItem</c> navigation must be
    /// Included for the live linked task title; when it is not loaded (e.g. the create/update path) the title
    /// falls back to the stored snapshot. Ordering is the caller's responsibility.
    /// </summary>
    public static JournalLogEntryResponseDto ToDto(JournalLogEntry l) => new()
    {
        Id = l.Id,
        Content = l.Content,
        JournalEntryId = l.JournalEntryId,
        CreatedAt = l.CreatedAt,
        UpdatedAt = l.UpdatedAt,
        TaskItemId = l.TaskItemId,
        LinkedTaskTitle = l.TaskItem?.Title ?? l.LinkedTaskTitleSnapshot,
        LinkedTaskDeleted = l.TaskItemId is null && l.LinkedTaskTitleSnapshot is not null,
    };
}
