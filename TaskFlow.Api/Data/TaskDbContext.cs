using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Data;

public class TaskDbContext(DbContextOptions<TaskDbContext> options) : DbContext(options)
{
    public DbSet<TaskItem> TaskItems => Set<TaskItem>();
    public DbSet<TaskItemEvent> TaskItemEvents => Set<TaskItemEvent>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalLogEntry> JournalLogEntries => Set<JournalLogEntry>();
    public DbSet<JournalNote> JournalNotes => Set<JournalNote>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<TaskItem>(entity =>
        {
            entity.Property(t => t.Status)
                  .HasConversion<int>();

            entity.HasOne(t => t.ParentTaskItem)
                .WithMany(t => t.ChildTaskItems)
                .HasForeignKey(t => t.ParentTaskItemId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(t => t.CurrentJournalEntry)
                .WithMany()
                .HasForeignKey(t => t.CurrentJournalEntryId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasMany(t => t.Events)
                .WithOne(e => e.TaskItem)
                .HasForeignKey(e => e.TaskItemId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TaskItemEvent>(entity =>
        {
            entity.Property(e => e.EventType)
                .HasMaxLength(64);

            entity.HasIndex(e => new { e.TaskItemId, e.OccurredAtUtc });
        });

        modelBuilder.Entity<Note>(entity =>
        {
            entity.HasOne(n => n.TaskItem)
                  .WithMany(t => t.Notes)
                  .HasForeignKey(n => n.TaskItemId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<JournalLogEntry>(entity =>
        {
            entity.HasOne(l => l.TaskItem)
                  .WithMany()
                  .HasForeignKey(l => l.TaskItemId)
                  .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(l => l.TaskItemId);
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

            entity.HasMany(e => e.Notes)
                  .WithOne(n => n.JournalEntry)
                  .HasForeignKey(n => n.JournalEntryId)
                  .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
