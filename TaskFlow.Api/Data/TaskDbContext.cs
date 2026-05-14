using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Data;

public class TaskDbContext(DbContextOptions<TaskDbContext> options) : DbContext(options)
{
    public DbSet<TaskItem> TaskItems => Set<TaskItem>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalLogEntry> JournalLogEntries => Set<JournalLogEntry>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<TaskItem>(entity =>
        {
            entity.Property(t => t.Status)
                  .HasConversion<int>();
        });

        modelBuilder.Entity<Note>(entity =>
        {
            entity.HasOne(n => n.TaskItem)
                  .WithMany(t => t.Notes)
                  .HasForeignKey(n => n.TaskItemId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<JournalEntry>(entity =>
        {
            entity.HasIndex(e => e.Date).IsUnique();

            entity.HasMany(e => e.LogEntries)
                  .WithOne(l => l.JournalEntry)
                  .HasForeignKey(l => l.JournalEntryId)
                  .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(e => e.Todos)
                  .WithMany()
                  .UsingEntity("JournalEntryTaskItem");
        });
    }
}
