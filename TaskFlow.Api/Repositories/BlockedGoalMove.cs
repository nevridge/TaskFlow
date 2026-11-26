using TaskFlow.Api.Models;

namespace TaskFlow.Api.Repositories;

/// <summary>The goal a moved task would take, and the Now goal that stops it.</summary>
public sealed record BlockedGoalMove(int GoalId, Goal NowGoal);
