using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations
{
    /// <inheritdoc />
    public partial class RemoveTaskItemIsComplete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Order matters. The synthetic history rows must be written first, while IsComplete still
            // exists and before Status changes, so the affected set is exactly the rows the UPDATE changes.
            migrationBuilder.Sql(
                """
                INSERT INTO "TaskItemEvents" ("TaskItemId", "EventType", "OccurredAtUtc", "ChangeSummary")
                SELECT "Id", 'Completed', strftime('%Y-%m-%d %H:%M:%f', 'now'),
                       'Marked complete by a data migration that merged the separate completion flag into Status. Recorded when the migration ran, not when the task was completed.'
                FROM "TaskItems"
                WHERE "IsComplete" = 1 AND "Status" <> 2;
                """);

            migrationBuilder.Sql(
                """
                UPDATE "TaskItems" SET "Status" = 2 WHERE "IsComplete" = 1 AND "Status" <> 2;
                """);

            migrationBuilder.DropColumn(
                name: "IsComplete",
                table: "TaskItems");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsComplete",
                table: "TaskItems",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            // History is append-only: the synthetic Completed events written by Up are intentionally kept.
            migrationBuilder.Sql(
                """
                UPDATE "TaskItems" SET "IsComplete" = 1 WHERE "Status" = 2;
                """);
        }
    }
}
