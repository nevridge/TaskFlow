using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskItemCompletedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CompletedAt",
                table: "TaskItems",
                type: "TEXT",
                nullable: true);

            // Backfill: a Completed task gets the latest genuine Completed event that is strictly after its latest
            // Reopened event. Synthetic events from the RemoveTaskItemIsComplete data migration are ignored. Tasks
            // with no usable event stay null (no date is invented, nothing is taken from the linked day).
            // OccurredAtUtc is TEXT in two formats (7 fractional digits from EF, 3 from strftime), so ordering and
            // comparison use julianday, and the ORIGINAL text is copied so EF can parse it back.
            // Status 2 = Completed.
            migrationBuilder.Sql(
                """
                UPDATE "TaskItems"
                SET "CompletedAt" = (
                    SELECT e."OccurredAtUtc"
                    FROM "TaskItemEvents" e
                    WHERE e."TaskItemId" = "TaskItems"."Id"
                      AND e."EventType" = 'Completed'
                      AND NOT (instr(COALESCE(e."ChangeSummary", ''), 'Marked complete by a data migration') = 1)
                      AND julianday(e."OccurredAtUtc") > COALESCE(
                          (SELECT MAX(julianday(r."OccurredAtUtc"))
                           FROM "TaskItemEvents" r
                           WHERE r."TaskItemId" = "TaskItems"."Id" AND r."EventType" = 'Reopened'), 0)
                    ORDER BY julianday(e."OccurredAtUtc") DESC
                    LIMIT 1)
                WHERE "Status" = 2;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompletedAt",
                table: "TaskItems");
        }
    }
}
