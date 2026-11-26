using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations;

/// <inheritdoc />
public partial class AddGoals : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "GoalId",
            table: "TaskItems",
            type: "INTEGER",
            nullable: true);

        migrationBuilder.CreateTable(
            name: "Goals",
            columns: table => new
            {
                Id = table.Column<int>(type: "INTEGER", nullable: false)
                    .Annotation("Sqlite:Autoincrement", true),
                ProjectId = table.Column<int>(type: "INTEGER", nullable: false),
                Title = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                Description = table.Column<string>(type: "TEXT", nullable: true),
                DoneWhen = table.Column<string>(type: "TEXT", nullable: true),
                Status = table.Column<int>(type: "INTEGER", nullable: false),
                ParkedReason = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                DisplayOrder = table.Column<int>(type: "INTEGER", nullable: false),
                StatusChangedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                ClosedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Goals", x => x.Id);
                table.ForeignKey(
                    name: "FK_Goals_Projects_ProjectId",
                    column: x => x.ProjectId,
                    principalTable: "Projects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_TaskItems_GoalId",
            table: "TaskItems",
            column: "GoalId");

        migrationBuilder.CreateIndex(
            name: "IX_Goals_ProjectId",
            table: "Goals",
            column: "ProjectId");

        migrationBuilder.AddForeignKey(
            name: "FK_TaskItems_Goals_GoalId",
            table: "TaskItems",
            column: "GoalId",
            principalTable: "Goals",
            principalColumn: "Id",
            onDelete: ReferentialAction.SetNull);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_TaskItems_Goals_GoalId",
            table: "TaskItems");

        migrationBuilder.DropTable(
            name: "Goals");

        migrationBuilder.DropIndex(
            name: "IX_TaskItems_GoalId",
            table: "TaskItems");

        migrationBuilder.DropColumn(
            name: "GoalId",
            table: "TaskItems");
    }
}
