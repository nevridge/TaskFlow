using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Extensions;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Data;

public class TaskDbContext(DbContextOptions<TaskDbContext> options) : DbContext(options)
{
    public DbSet<TaskItem> TaskItems => Set<TaskItem>();
    public DbSet<TaskItemEvent> TaskItemEvents => Set<TaskItemEvent>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Area> Areas => Set<Area>();
    public DbSet<Goal> Goals => Set<Goal>();
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

            entity.Property(t => t.PreviousStatus)
                  .HasConversion<int>();

            entity.Property(t => t.BlockedReason)
                  .HasMaxLength(200);

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

            entity.HasOne(t => t.Project)
                .WithMany(p => p.Tasks)
                .HasForeignKey(t => t.ProjectId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(t => t.ProjectId);

            entity.HasOne(t => t.Goal)
                .WithMany(g => g.Tasks)
                .HasForeignKey(t => t.GoalId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(t => t.GoalId);
        });

        modelBuilder.Entity<Goal>(entity =>
        {
            entity.Property(g => g.Title)
                .HasMaxLength(100);

            entity.Property(g => g.ParkedReason)
                .HasMaxLength(200);

            entity.Property(g => g.Status)
                .HasConversion<int>();

            entity.HasOne(g => g.Project)
                .WithMany(p => p.Goals)
                .HasForeignKey(g => g.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(g => g.ProjectId);
        });

        modelBuilder.Entity<Project>(entity =>
        {
            entity.Property(p => p.Name)
                .HasMaxLength(100)
                .UseCollation("NOCASE");

            entity.HasIndex(p => p.Name).IsUnique();

            // Restrict, not the usual SetNull: the database must never clear a project's area silently.
            entity.HasOne(p => p.Area)
                .WithMany(a => a.Projects)
                .HasForeignKey(p => p.AreaId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Area>(entity =>
        {
            entity.Property(a => a.Name)
                .HasMaxLength(100)
                .UseCollation("NOCASE");

            entity.HasIndex(a => a.Name).IsUnique();
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

        modelBuilder.ApplyUtcAuditTimestamps();
    }
}
