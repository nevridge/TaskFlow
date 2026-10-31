using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations
{
    /// <inheritdoc />
    public partial class ConvertTaskItemDueDateToDateOnly : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Data-only: DueDate is TEXT before and after (DateTime -> DateOnly), so no DDL is needed.
            // Keep the date part only (first 10 chars of 'yyyy-MM-dd HH:mm:ss[.fffffff]' or 'yyyy-MM-ddTHH:mm:ss').
            // No timezone conversion; NULLs stay NULL; idempotent.
            migrationBuilder.Sql(
                """
                UPDATE "TaskItems" SET "DueDate" = substr("DueDate", 1, 10) WHERE "DueDate" IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Best-effort: restore a midnight time portion. Any original time-of-day is not recoverable.
            migrationBuilder.Sql(
                """
                UPDATE "TaskItems" SET "DueDate" = "DueDate" || ' 00:00:00' WHERE "DueDate" IS NOT NULL AND length("DueDate") = 10;
                """);
        }
    }
}
