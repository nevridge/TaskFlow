# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app

# Install curl for container health checks (used by docker-compose healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Create dirs, add placeholder files so Docker named-volume initialization
# copies them with the intended ownership, and assign ownership to 'app'.
# This avoids first-run permission issues for SQLite/log writes when
# /app/data or /app/logs are mounted as named volumes.
RUN mkdir -p /app/logs /app/data \
    && touch /app/logs/.keep /app/data/.keep \
    && chown -R app:app /app/logs /app/data

# ASPNETCORE_ENVIRONMENT is intentionally NOT set here.
# It is injected at runtime by docker-compose / CI/CD per environment.
ENV ASPNETCORE_HTTP_PORTS=8080

EXPOSE 8080

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["Directory.Build.props", "./"]
COPY ["TaskFlow.Api/TaskFlow.Api.csproj", "TaskFlow.Api/"]
RUN dotnet restore "TaskFlow.Api/TaskFlow.Api.csproj"

COPY TaskFlow.Api/ TaskFlow.Api/
WORKDIR /src/TaskFlow.Api
RUN dotnet publish "TaskFlow.Api.csproj" -c Release -o /app/publish \
    /p:UseAppHost=false --no-restore

FROM base AS final

# Switch to non-root user (built into the aspnet base image)
USER app

COPY --from=build --chown=app /app/publish .

ENTRYPOINT ["dotnet", "TaskFlow.Api.dll"]
