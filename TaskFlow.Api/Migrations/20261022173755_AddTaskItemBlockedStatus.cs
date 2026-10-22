using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskItemBlockedStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "BlockedAt",
                table: "TaskItems",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BlockedReason",
                table: "TaskItems",
                type: "TEXT",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PreviousStatus",
                table: "TaskItems",
                type: "INTEGER",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Blocked (3) does not exist before this migration: restore each blocked row to the
            // status it had before it was blocked (Todo when unknown). The blocked reason is lost.
            migrationBuilder.Sql(
                """
                UPDATE "TaskItems" SET "Status" = COALESCE("PreviousStatus", 1) WHERE "Status" = 3;
                """);

            migrationBuilder.DropColumn(
                name: "BlockedAt",
                table: "TaskItems");

            migrationBuilder.DropColumn(
                name: "BlockedReason",
                table: "TaskItems");

            migrationBuilder.DropColumn(
                name: "PreviousStatus",
                table: "TaskItems");
        }
    }
}
