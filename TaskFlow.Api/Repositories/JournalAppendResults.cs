namespace TaskFlow.Api.Repositories;

public enum AppendSummaryStatus
{
    Success,
    NotFound,
    TooLong,
}

/// <summary>
/// Outcome of a summary append. The lengths are set for <see cref="AppendSummaryStatus.TooLong"/>:
/// <see cref="ExistingLength"/> is the stored summary after its trailing whitespace is trimmed (0 when blank),
/// <see cref="TextLength"/> the appended text and <see cref="CombinedLength"/> the result that was refused.
/// </summary>
public sealed record AppendSummaryResult(
    AppendSummaryStatus Status,
    int ExistingLength = 0,
    int TextLength = 0,
    int CombinedLength = 0);
