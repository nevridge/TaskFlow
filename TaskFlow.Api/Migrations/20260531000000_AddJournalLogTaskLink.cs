using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJournalLogTaskLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LinkedTaskTitleSnapshot",
                table: "JournalLogEntries",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TaskItemId",
                table: "JournalLogEntries",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_JournalLogEntries_TaskItemId",
                table: "JournalLogEntries",
                column: "TaskItemId");

            migrationBuilder.AddForeignKey(
                name: "FK_JournalLogEntries_TaskItems_TaskItemId",
                table: "JournalLogEntries",
                column: "TaskItemId",
                principalTable: "TaskItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_JournalLogEntries_TaskItems_TaskItemId",
                table: "JournalLogEntries");

            migrationBuilder.DropIndex(
                name: "IX_JournalLogEntries_TaskItemId",
                table: "JournalLogEntries");

            migrationBuilder.DropColumn(
                name: "LinkedTaskTitleSnapshot",
                table: "JournalLogEntries");

            migrationBuilder.DropColumn(
                name: "TaskItemId",
                table: "JournalLogEntries");
        }
    }
}
