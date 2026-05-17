using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskOwnershipMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CurrentJournalEntryId",
                table: "TaskItems",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "FirstTaggedDate",
                table: "TaskItems",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MoveCount",
                table: "TaskItems",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql(@"
UPDATE TaskItems
SET
    CurrentJournalEntryId = (
        SELECT jeti.JournalEntryId
        FROM JournalEntryTaskItem AS jeti
        INNER JOIN JournalEntries AS je ON je.Id = jeti.JournalEntryId
        WHERE jeti.TodosId = TaskItems.Id
        ORDER BY je.Date DESC, jeti.JournalEntryId DESC
        LIMIT 1
    ),
    FirstTaggedDate = (
        SELECT je.Date
        FROM JournalEntryTaskItem AS jeti
        INNER JOIN JournalEntries AS je ON je.Id = jeti.JournalEntryId
        WHERE jeti.TodosId = TaskItems.Id
        ORDER BY je.Date ASC, jeti.JournalEntryId ASC
        LIMIT 1
    ),
    MoveCount = (
        SELECT CASE
            WHEN COUNT(*) > 0 THEN COUNT(*) - 1
            ELSE 0
        END
        FROM JournalEntryTaskItem AS jeti
        WHERE jeti.TodosId = TaskItems.Id
    )
WHERE EXISTS (
    SELECT 1
    FROM JournalEntryTaskItem AS jeti
    WHERE jeti.TodosId = TaskItems.Id
);
");

            migrationBuilder.CreateIndex(
                name: "IX_TaskItems_CurrentJournalEntryId",
                table: "TaskItems",
                column: "CurrentJournalEntryId");

            migrationBuilder.AddForeignKey(
                name: "FK_TaskItems_JournalEntries_CurrentJournalEntryId",
                table: "TaskItems",
                column: "CurrentJournalEntryId",
                principalTable: "JournalEntries",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TaskItems_JournalEntries_CurrentJournalEntryId",
                table: "TaskItems");

            migrationBuilder.DropIndex(
                name: "IX_TaskItems_CurrentJournalEntryId",
                table: "TaskItems");

            migrationBuilder.DropColumn(
                name: "CurrentJournalEntryId",
                table: "TaskItems");

            migrationBuilder.DropColumn(
                name: "FirstTaggedDate",
                table: "TaskItems");

            migrationBuilder.DropColumn(
                name: "MoveCount",
                table: "TaskItems");
        }
    }
}
