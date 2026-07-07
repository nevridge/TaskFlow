namespace TaskFlow.Api.Helpers;

public static class DaysTaggedHelper
{
    public static int GetDaysTagged(DateOnly? firstTaggedDate, DateOnly? currentJournalDate)
    {
        if (!firstTaggedDate.HasValue || !currentJournalDate.HasValue)
        {
            return 0;
        }

        return Math.Max(0, currentJournalDate.Value.DayNumber - firstTaggedDate.Value.DayNumber + 1);
    }
}
