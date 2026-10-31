using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Tests.Helpers;

public class JournalDayRuleTests
{
    private static readonly DateOnly Mon = new(2026, 6, 1);
    private static readonly DateOnly Wed = new(2026, 6, 3);

    private static DateTime Utc(int day, int hour, int minute = 0, int second = 0) =>
        new(2026, 6, day, hour, minute, second, DateTimeKind.Utc);

    private static TaskItem Completed(DateTime? at) => new() { Title = "t", Status = Status.Completed, CompletedAt = at };

    // ---- AC1-AC4 ----

    [Fact]
    public void GetAttributedDay_LinkedMonCompletedWed_IsWedForCompletionRow_AndKeepsOwnLinkedDayInput()
    {
        var task = Completed(Utc(3, 12));

        Assert.Equal(Wed, JournalDayRule.GetAttributedDay(task, Mon, null));
        Assert.NotEqual(Mon, JournalDayRule.GetAttributedDay(task, Mon, null));
    }

    [Fact]
    public void GetAttributedDay_NeverLinkedCompleted_IsCompletionDay()
    {
        Assert.Equal(Wed, JournalDayRule.GetAttributedDay(Completed(Utc(3, 12)), null, null));
    }

    [Fact]
    public void GetAttributedDay_CompletedWithoutCompletedAt_UsesLinkedDay()
    {
        Assert.Equal(Mon, JournalDayRule.GetAttributedDay(Completed(null), Mon, null));
        Assert.Null(JournalDayRule.GetAttributedDay(Completed(null), null, null));
    }

    [Theory]
    [InlineData(Status.Draft)]
    [InlineData(Status.Todo)]
    [InlineData(Status.InProgress)]
    [InlineData(Status.Blocked)]
    public void GetAttributedDay_OpenTask_UsesLinkedDay_EvenWithStaleCompletedAt(Status status)
    {
        var task = new TaskItem { Title = "t", Status = status, CompletedAt = Utc(3, 12) };

        Assert.False(JournalDayRule.IsCompletionDayRow(task));
        Assert.Equal(Mon, JournalDayRule.GetAttributedDay(task, Mon, null));
        Assert.Null(JournalDayRule.GetAttributedDay(task, null, null));
    }

    [Fact]
    public void IsCompletionDayRow_RequiresCompletedStatusAndCompletedAt()
    {
        Assert.True(JournalDayRule.IsCompletionDayRow(Completed(Utc(3, 1))));
        Assert.False(JournalDayRule.IsCompletionDayRow(Completed(null)));
    }

    // ---- offset conversion ----

    [Fact]
    public void GetUtcRange_NullOffsetIsUtc_AndZeroOffsetMatches()
    {
        var expected = (Utc(3, 0), Utc(4, 0));

        Assert.Equal(expected, JournalDayRule.GetUtcRange(Wed, null));
        Assert.Equal(expected, JournalDayRule.GetUtcRange(Wed, 0));
    }

    [Fact]
    public void GetUtcRange_UtcMinus5_StartsFiveHoursIntoTheUtcDay()
    {
        var (start, end) = JournalDayRule.GetUtcRange(Wed, -300);

        Assert.Equal(Utc(3, 5), start);
        Assert.Equal(Utc(4, 5), end);
        Assert.Equal(DateTimeKind.Utc, start.Kind);
    }

    [Fact]
    public void GetUtcRange_UtcPlus14_StartsTenHoursIntoThePreviousUtcDay()
    {
        var (start, end) = JournalDayRule.GetUtcRange(Wed, 840);

        Assert.Equal(Utc(2, 10), start);
        Assert.Equal(Utc(3, 10), end);
    }

    [Theory]
    [InlineData(-300, 3, 4, 59, 59, 2)]   // 23:59:59 local Tue
    [InlineData(-300, 3, 5, 0, 0, 3)]     // 00:00:00 local Wed
    [InlineData(-300, 4, 4, 59, 59, 3)]   // 23:59:59 local Wed
    [InlineData(-300, 4, 5, 0, 0, 4)]     // 00:00:00 local Thu
    [InlineData(840, 3, 9, 59, 59, 3)]    // 23:59:59 local Wed
    [InlineData(840, 3, 10, 0, 0, 4)]     // 00:00:00 local Thu
    [InlineData(840, 2, 9, 59, 59, 2)]    // 23:59:59 local Tue
    [InlineData(840, 2, 10, 0, 0, 3)]     // 00:00:00 local Wed
    [InlineData(null, 3, 0, 0, 0, 3)]
    [InlineData(null, 2, 23, 59, 59, 2)]
    public void GetAttributedDay_CompletionRow_ConvertsWithOffsetAtDayBoundaries(
        int? offset, int day, int hour, int minute, int second, int expectedDay)
    {
        var task = Completed(Utc(day, hour, minute, second));

        Assert.Equal(new DateOnly(2026, 6, expectedDay), JournalDayRule.GetAttributedDay(task, null, offset));
    }

    // ---- parity between the SQL-side predicate and the in-memory rule ----

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-300)]
    [InlineData(840)]
    [InlineData(-720)]
    public void OnDayPredicate_AgreesWithGetAttributedDay_ForEveryTaskShape(int? offset)
    {
        var entryId = 7;
        var entries = new Dictionary<int, DateOnly> { [7] = Wed, [8] = Mon };
        var completionInstants = new DateTime?[]
        {
            null,
            Utc(1, 0), Utc(2, 9, 59, 59), Utc(2, 10), Utc(2, 23, 59, 59), Utc(3, 0), Utc(3, 4, 59, 59), Utc(3, 5),
            Utc(3, 9, 59, 59), Utc(3, 10), Utc(3, 23, 59, 59), Utc(4, 0), Utc(4, 4, 59, 59), Utc(4, 5), Utc(4, 10), Utc(5, 0),
        };

        var tasks = new List<TaskItem>();
        foreach (var status in Enum.GetValues<Status>())
        {
            foreach (var link in new int?[] { null, 7, 8 })
            {
                foreach (var at in completionInstants)
                {
                    tasks.Add(new TaskItem { Title = "t", Status = status, CurrentJournalEntryId = link, CompletedAt = at });
                }
            }
        }

        var (start, end) = JournalDayRule.GetUtcRange(Wed, offset);
        var predicate = JournalDayRule.OnDayPredicate(entryId, start, end).Compile();

        foreach (var task in tasks)
        {
            DateOnly? linked = task.CurrentJournalEntryId is { } id ? entries[id] : null;
            var attributedToWed = JournalDayRule.GetAttributedDay(task, linked, offset) == Wed;

            Assert.True(
                attributedToWed == predicate(task),
                $"Status={task.Status} link={task.CurrentJournalEntryId} completedAt={task.CompletedAt:O} offset={offset}");
        }
    }

    [Fact]
    public void OnDayPredicate_CompletedTaskLinkedToEntry_IsNotOnLinkedDayWhenCompletedElsewhere()
    {
        var (start, end) = JournalDayRule.GetUtcRange(Mon, null);
        var predicate = JournalDayRule.OnDayPredicate(1, start, end).Compile();
        var task = new TaskItem { Title = "t", Status = Status.Completed, CompletedAt = Utc(3, 12), CurrentJournalEntryId = 1 };

        Assert.False(predicate(task));
    }

    // ---- subtasks follow the same per-task rule ----

    [Fact]
    public void GetAttributedDay_SubtaskCompletedOnDWithParentOnE_IsAttributedToD()
    {
        var parent = new TaskItem { Id = 1, Title = "p", Status = Status.Todo };
        var child = new TaskItem
        {
            Id = 2,
            Title = "c",
            Status = Status.Completed,
            CompletedAt = Utc(3, 12),
            ParentTaskItemId = 1,
            ParentTaskItem = parent,
        };

        Assert.Equal(Wed, JournalDayRule.GetAttributedDay(child, null, null));
        Assert.Equal(Mon, JournalDayRule.GetAttributedDay(parent, Mon, null));
    }
}
