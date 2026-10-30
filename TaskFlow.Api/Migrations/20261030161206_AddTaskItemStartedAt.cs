using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskItemStartedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "StartedAt",
                table: "TaskItems",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // InProgress (4) does not exist before this migration. Blocked rows that would restore to
            // InProgress fall back to Todo (1), then InProgress rows become Todo. StartedAt is lost.
            // Must run before the older Down, whose COALESCE("PreviousStatus", 1) would restore 4.
            migrationBuilder.Sql(
                """
                UPDATE "TaskItems" SET "PreviousStatus" = 1 WHERE "PreviousStatus" = 4;
                """);

            migrationBuilder.Sql(
                """
                UPDATE "TaskItems" SET "Status" = 1 WHERE "Status" = 4;
                """);

            migrationBuilder.DropColumn(
                name: "StartedAt",
                table: "TaskItems");
        }
    }
}
