using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations;

/// <inheritdoc />
public partial class AddAreas : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "AreaId",
            table: "Projects",
            type: "INTEGER",
            nullable: true);

        migrationBuilder.CreateTable(
            name: "Areas",
            columns: table => new
            {
                Id = table.Column<int>(type: "INTEGER", nullable: false)
                    .Annotation("Sqlite:Autoincrement", true),
                Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false, collation: "NOCASE"),
                DisplayOrder = table.Column<int>(type: "INTEGER", nullable: false),
                CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Areas", x => x.Id);
            });

        migrationBuilder.CreateIndex(
            name: "IX_Projects_AreaId",
            table: "Projects",
            column: "AreaId");

        migrationBuilder.CreateIndex(
            name: "IX_Areas_Name",
            table: "Areas",
            column: "Name",
            unique: true);

        migrationBuilder.AddForeignKey(
            name: "FK_Projects_Areas_AreaId",
            table: "Projects",
            column: "AreaId",
            principalTable: "Areas",
            principalColumn: "Id",
            onDelete: ReferentialAction.Restrict);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_Projects_Areas_AreaId",
            table: "Projects");

        migrationBuilder.DropTable(
            name: "Areas");

        migrationBuilder.DropIndex(
            name: "IX_Projects_AreaId",
            table: "Projects");

        migrationBuilder.DropColumn(
            name: "AreaId",
            table: "Projects");
    }
}
