# API Reference

Complete reference for TaskFlow.Api REST endpoints.

## Base URL

**Local Development:**
- Direct run: `https://localhost:{port}` (port shown in console)
- Docker: `http://localhost:8080`

**Production:**
- API: `https://taskflow-api.skalaforge.com`
- Web: `https://taskflow.skalaforge.com`

## Authentication

Currently, no authentication is required. All endpoints are publicly accessible.

## Content Type

All endpoints accept and return `application/json`.

## Date Wire Format

`dueDate` is a calendar date, `YYYY-MM-DD` (for example `"2026-05-01"`), with no time or timezone. It is read and written as the same day everywhere. `null` means no due date. A datetime string such as `"2026-05-01T00:00:00Z"`, an empty string, or any malformed date (`"05/01/2026"`, `"2026-13-40"`) is rejected with `400 Bad Request`. Other timestamp fields (`createdAt`, `updatedAt`, `blockedAt`, `startedAt`) remain UTC instants. Existing stored due dates were converted to their date part by migration `20261030234403_ConvertTaskItemDueDateToDateOnly`, so any time-of-day part of older values was dropped, with no timezone conversion.

## Task Items API

### Current v1 Contract Highlights (May 2026)

The snippets below describe the currently implemented contract additions used by the Journal and Tasks screens.

#### Task response projection fields

`TaskItemResponseDto` now includes assignment, movement, and hierarchy metadata in addition to core task fields:

- `currentJournalEntryId: number | null`
- `currentJournalDate: string | null` (ISO date)
- `firstTaggedDate: string | null` (ISO date)
- `lastMovedDate: string | null` (ISO date)
- `daysTagged: number`
- `moveCount: number`
- `parentTaskItemId: number | null`
- `childTaskCount: number`

#### Create task with optional journal assignment

`POST /api/v1/TaskItems` accepts optional `journalDate`:

```json
{
  "title": "Prepare demo",
  "status": "todo",
  "journalDate": "2026-05-20"
}
```

Behavior:

- If `journalDate` is in the past, returns `422` with `TASK_CREATION_PAST_DAY_NOT_ALLOWED` (the same code is returned by `PUT`/`PATCH` when planning on a past day). "Today" comes from `timezoneOffsetMinutes`, falling back to the UTC date when omitted.
- If `journalDate` is today/future, the task is automatically assigned to that journal day.

#### Task history endpoint

`GET /api/v1/TaskItems/{id}/history` returns timeline entries (`TaskItemEventResponseDto[]`) in chronological order.

#### Hierarchy validation rules (422)

Task parent/child updates return machine-readable error payloads (`code`, `message`, `details?`) for:

- `TASK_PARENT_NOT_FOUND`
- `TASK_PARENT_SELF_NOT_ALLOWED`
- `TASK_PARENT_DEPTH_NOT_ALLOWED` (one subtask level only)
- `TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN`
- `TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN`
- `TASK_REOPEN_PAST_DAY_NOT_ALLOWED`

#### Reopen past-day guard and `timezoneOffsetMinutes`

`PUT /api/v1/TaskItems/{id}` accepts optional `timezoneOffsetMinutes` (minutes to add to UTC to get the user's local time; negative west of UTC, e.g. `-300` for US Central CDT). When a completed task is reopened, the offset is used to compute the user's local today for the past-day guard. A task assigned to the user's local today can be reopened; an earlier assigned date returns `422` `TASK_REOPEN_PAST_DAY_NOT_ALLOWED` (the response `details` include the task's `assignedDate`). If `timezoneOffsetMinutes` is omitted, the guard falls back to the UTC date. The same offset-derived "today" is used for the `journalDate` past-day check on update.

### List All Tasks

Retrieves all task items with status information.

**Endpoint:** `GET /api/v1/TaskItems`

**Response:** `200 OK`

```json
[
  {
    "id": 1,
    "title": "Complete project documentation",
    "description": "Write comprehensive API documentation",
    "statusName": "To Do"
  },
  {
    "id": 2,
    "title": "Deploy to Azure",
    "description": "Set up production environment",
    "statusName": "Done"
  }
]
```

**Example:**
```bash
curl http://localhost:8080/api/v1/TaskItems
```

---

### Get Task by ID

Retrieves a specific task item with status information.

**Endpoint:** `GET /api/v1/TaskItems/{id}`

**Parameters:**
- `id` (path, integer, required) - Task item ID

**Response:** `200 OK`

```json
{
  "id": 1,
  "title": "Complete project documentation",
  "description": "Write comprehensive API documentation",
  "statusName": "To Do"
}
```

**Error Response:** `404 Not Found`

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
  "title": "Not Found",
  "status": 404
}
```

**Example:**
```bash
curl http://localhost:8080/api/v1/TaskItems/1
```

---

### Create Task

Creates a new task item with status assignment.

**Endpoint:** `POST /api/v1/TaskItems`

**Request Body:**

```json
{
  "title": "Complete project documentation",
  "description": "Write comprehensive API documentation",
  "statusId": 1
}
```

**Fields:**
- `title` (string, required, max 100 chars) - Task title
- `description` (string, optional) - Task description
- `statusId` (integer, optional, defaults to 1) - Status ID to assign

**Response:** `201 Created`

```json
{
  "id": 3,
  "title": "Complete project documentation",
  "description": "Write comprehensive API documentation",
  "statusName": "To Do"
}
```

**Location Header:** `/api/v1/TaskItems/3`

**Validation Error:** `400 Bad Request`

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "Title": ["Title is required"]
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/v1/TaskItems \
  -H "Content-Type: application/json" \
  -d '{
    "title": "New Task",
    "description": "Task description",
    "statusId": 1
  }'
```

---

### Update Task

Updates an existing task item, including status assignment and optional journal planning.

**Endpoint:** `PUT /api/v1/TaskItems/{id}`

**Parameters:**
- `id` (path, integer, required) - Task item ID to update

**Request Body:**

```json
{
  "title": "Updated task title",
  "description": "Updated description",
  "status": "InProgress",
  "journalDate": "2026-05-20"
}
```

**Fields:**
- `title` (string, required, max 100 chars) - Task title
- `description` (string, optional) - Task description
- `status` (string, optional) - Status name (`Draft`, `Todo`, `InProgress`, `Blocked`, `Completed`); omitted/`null` leaves it unchanged
- `journalDate` (string, ISO date, optional) - Journal day to plan the task on; see semantics below
- `timezoneOffsetMinutes` (integer, optional, -720..840) - Used to derive the user's today

**Response:** `200 OK`

```json
{
  "id": 1,
  "title": "Updated task title",
  "description": "Updated description",
  "status": "InProgress",
  "currentJournalDate": "2026-05-20"
}
```

**`journalDate` semantics (optional, also accepted by `PATCH`):**

- `null` or omitted leaves the planned day unchanged. There is no way to un-plan a task through an update.
- Only today or later is accepted. "Today" is derived from `timezoneOffsetMinutes` (same offset as the reopen guard); without an offset it falls back to the UTC date. A missing journal entry for the date is created.
- Sending the day the task is already planned on succeeds and applies the other changes, even when that day is in the past (this check runs before the past-day check).
- Planning a task already on another day moves it: the old link is removed, `moveCount` increases and a `ReassignedToJournalDay` event is recorded; `firstTaggedDate` is kept. The first assignment is not a move (`moveCount` stays 0).
- Planning is allowed for any status, and `status` may change in the same request.
- The field update and the planning are atomic: if planning fails nothing is saved.
- Planning a parent does not plan its subtasks, and no carry-forward of other tasks happens (API-only clients planning for today do not trigger carry-forward).
- The response is re-read from storage and shows the planned day in `currentJournalDate`.

**Error Responses:**

`404 Not Found` - Task doesn't exist
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
  "title": "Not Found",
  "status": 404
}
```

`400 Bad Request` - Validation failure (including `timezoneOffsetMinutes` outside -720..840)
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "Title": ["Title cannot exceed 100 characters"]
  }
}
```

`422 Unprocessable Entity` - `journalDate` before the user's today; nothing is changed
```json
{
  "code": "TASK_CREATION_PAST_DAY_NOT_ALLOWED",
  "message": "You cannot plan a task on a past journal day.",
  "details": { "journalDate": "2026-05-01" }
}
```

`409 Conflict` - another request planned the task on that day at the same time; nothing is changed
```json
{
  "code": "TASK_JOURNAL_ASSIGNMENT_CONFLICT",
  "message": "The task was planned on this day by another request."
}
```

**Example:**
```bash
curl -X PUT http://localhost:8080/api/v1/TaskItems/1 \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "description": "Updated description",
    "status": "InProgress",
    "journalDate": "2026-05-20"
  }'
```

---

### Partially Update Task

Updates only the fields present in the request body (JSON Merge Patch semantics).

**Endpoint:** `PATCH /api/v1/TaskItems/{id}`

**Request Body:** any subset of `title`, `description`, `status`, `priority`, `dueDate`, `parentTaskItemId`, `autoCompleteParentWhenChildrenDone`, `timezoneOffsetMinutes`, `journalDate`.

- An omitted field is left unchanged and writes no history event.
- An explicit `null` clears `description`, `dueDate` or `parentTaskItemId`.
- `journalDate` plans the task on a journal day exactly as on `PUT` (see Update Task); an explicit `null` or omitting it leaves the planned day unchanged.
- `status` or `priority` set to `null` or omitted means unchanged.
- An empty `title` returns `400 Bad Request`; an unknown id returns `404 Not Found`.
- Completion is set only through `status` (`Completed`); `isComplete` is not part of the contract and is ignored if sent.

**Example:**
```bash
curl -X PATCH http://localhost:8080/api/v1/TaskItems/1 \
  -H "Content-Type: application/json" \
  -d '{"title": "Renamed"}'
```

---

### Delete Task

Deletes a task item.

**Endpoint:** `DELETE /api/v1/TaskItems/{id}`

**Parameters:**
- `id` (path, integer, required) - Task item ID to delete

**Response:** `204 No Content`

**Error Response:** `404 Not Found`

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
  "title": "Not Found",
  "status": 404
}
```

**Example:**
```bash
curl -X DELETE http://localhost:8080/api/v1/TaskItems/1
```

---

## Status API

### List All Statuses

Retrieves all status items.

**Endpoint:** `GET /api/v1/Status`

**Response:** `200 OK`

```json
[
  {
    "id": 1,
    "name": "To Do",
    "description": "Task has not been started"
  },
  {
    "id": 2,
    "name": "In Progress",
    "description": "Task is currently being worked on"
  },
  {
    "id": 3,
    "name": "Done",
    "description": "Task has been completed"
  }
]
```

**Example:**
```bash
curl http://localhost:8080/api/v1/Status
```

---

### Get Status by ID

Retrieves a specific status item.

**Endpoint:** `GET /api/v1/Status/{id}`

**Parameters:**
- `id` (path, integer, required) - Status item ID

**Response:** `200 OK`

```json
{
  "id": 1,
  "name": "To Do",
  "description": "Task has not been started"
}
```

**Error Response:** `404 Not Found`

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
  "title": "Not Found",
  "status": 404
}
```

**Example:**
```bash
curl http://localhost:8080/api/v1/Status/1
```

---

### Create Status

Creates a new status item.

**Endpoint:** `POST /api/v1/Status`

**Request Body:**

```json
{
  "name": "In Review",
  "description": "Task is under review"
}
```

**Fields:**
- `name` (string, required, max 50 chars) - Status name (must be unique)
- `description` (string, optional, max 200 chars) - Status description

**Response:** `201 Created`

```json
{
  "id": 4,
  "name": "In Review",
  "description": "Task is under review"
}
```

**Location Header:** `/api/v1/Status/4`

**Validation Error:** `400 Bad Request`

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "Name": ["Status name is required"],
    "Description": ["Status description cannot exceed 200 characters"]
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/v1/Status \
  -H "Content-Type: application/json" \
  -d '{
    "name": "In Review",
    "description": "Task is under review"
  }'
```

---

### Update Status

Updates an existing status item.

**Endpoint:** `PUT /api/v1/Status/{id}`

**Parameters:**
- `id` (path, integer, required) - Status item ID to update

**Request Body:**

```json
{
  "name": "Under Review",
  "description": "Task is being reviewed by the team"
}
```

**Fields:**
- `name` (string, required, max 50 chars) - Status name (must be unique)
- `description` (string, optional, max 200 chars) - Status description

**Response:** `200 OK`

Example response:
```json
{
  "id": 42,
  "name": "Under Review",
  "description": "Task is being reviewed by the team"
}
**Error Responses:**

`404 Not Found` - Status doesn't exist
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
  "title": "Not Found",
  "status": 404
}
```

`400 Bad Request` - Validation failure
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "Name": [
      "Status name cannot exceed 50 characters",
      "A status with the same name already exists."
    ]
  }
}
```

**Example:**
```bash
curl -X PUT http://localhost:8080/api/v1/Status/4 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Under Review",
    "description": "Task is being reviewed by the team"
  }'
```

---

### Delete Status

Deletes a status item.

**Endpoint:** `DELETE /api/v1/Status/{id}`

**Parameters:**
- `id` (path, integer, required) - Status item ID to delete

**Response:** `204 No Content`

**Error Response:** `404 Not Found`

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
  "title": "Not Found",
  "status": 404
}
```

**Example:**
```bash
curl -X DELETE http://localhost:8080/api/v1/Status/4
```

---

## Health Check Endpoints

### Overall Health

Returns comprehensive health status including all registered checks.

**Endpoint:** `GET /health`

**Response:** `200 OK` (Healthy) or `503 Service Unavailable` (Unhealthy)

```json
{
  "status": "Healthy",
  "totalDuration": 25.4551,
  "results": [
    {
      "name": "database",
      "status": "Healthy",
      "description": "",
      "duration": 20.355,
      "exception": null,
      "data": null
    },
    {
      "name": "self",
      "status": "Healthy",
      "description": "Application is running",
      "duration": 1.0933,
      "exception": null,
      "data": null
    }
  ]
}
```

**Use case:** General health monitoring, load balancer health checks

**Example:**
```bash
curl http://localhost:8080/health
```

---

### Readiness Probe

Indicates if the application is ready to receive traffic.

**Endpoint:** `GET /health/ready`

**Response:** `200 OK` (Ready) or `503 Service Unavailable` (Not Ready)

```json
{
  "status": "Healthy",
  "totalDuration": 43.2066,
  "results": [
    {
      "name": "database",
      "status": "Healthy",
      "description": "",
      "duration": 40.8122,
      "exception": null,
      "data": null
    }
  ]
}
```

**Use case:** Kubernetes readiness probes, load balancer registration

**Example:**
```bash
curl http://localhost:8080/health/ready
```

---

### Liveness Probe

Indicates if the application is alive and responsive.

**Endpoint:** `GET /health/live`

**Response:** `200 OK` (Alive) or `503 Service Unavailable` (Dead)

```json
{
  "status": "Healthy",
  "totalDuration": 0.1649,
  "results": [
    {
      "name": "self",
      "status": "Healthy",
      "description": "Application is running",
      "duration": 0.0911,
      "exception": null,
      "data": null
    }
  ]
}
```

**Use case:** Kubernetes liveness probes, restart decisions

**Example:**
```bash
curl http://localhost:8080/health/live
```

---

## Response Status Codes

| Status Code | Meaning | When Used |
|------------|---------|-----------|
| `200 OK` | Success | GET requests successful |
| `201 Created` | Resource created | POST successful |
| `204 No Content` | Success with no body | PUT, DELETE successful |
| `400 Bad Request` | Validation error | Invalid input data |
| `404 Not Found` | Resource not found | Requested item doesn't exist |
| `500 Internal Server Error` | Server error | Unexpected server-side error |
| `503 Service Unavailable` | Service unhealthy | Health check failure |

## Error Response Format

All error responses follow RFC 7807 Problem Details format:

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "FieldName": ["Error message"]
  }
}
```

## Validation Rules

### Task Item

**Title:**
- Required
- Maximum 200 characters
- Cannot be empty or whitespace

**Description:**
- Optional
- Maximum 1000 characters when provided

**Status:**
- Optional on create and update; an omitted value keeps the stored status
- Completion is expressed only through `Completed`; there is no `isComplete` field

### Status

**Name:**
- Required
- Maximum 50 characters
- Must be unique across all statuses
- Cannot be empty or whitespace

**Description:**
- Optional
- Maximum 200 characters when provided

## Swagger/OpenAPI Documentation

In Development mode, interactive API documentation is available via Swagger UI.

**Access Swagger:**
- Local: Navigate to `https://localhost:{port}` or `http://localhost:8080`
- Features:
  - Interactive endpoint testing
  - Request/response examples
  - Schema definitions
  - Try it out functionality

**Note:** Swagger is disabled in Production mode for security and performance.

## Postman Collection

A pre-configured Postman collection is available for testing:

**Collection URL:** https://studyplan-9664.postman.co/workspace/StudyPlan~b854a959-3425-41a8-9125-d9e7335da054/collection/102031-e46c6909-f827-46a6-affb-06cae2c01a09

**Setup:**
1. Import collection in Postman: **File → Import** → paste URL
2. Create environment with variable:
   - Name: `baseUrl`
   - Value: `http://localhost:8080` (or your deployment URL)
3. Run requests from the collection

## Rate Limiting

Currently, no rate limiting is implemented. All clients can make unlimited requests.

## CORS

CORS is configured to allow all origins in Development mode. For production deployments, configure specific allowed origins in `Program.cs`.

## Pagination

The current API does not implement pagination. All GET requests return all matching records.

**Future enhancement:** Consider adding pagination for large datasets:
```
GET /api/TaskItems?page=1&pageSize=20
```

## Filtering and Sorting

Currently not implemented. All tasks are returned in database order.

**Future enhancements:**
```
GET /api/TaskItems?status=Completed
GET /api/TaskItems?sortBy=createdAt&order=desc
```

## Examples

### Complete CRUD Workflow (Legacy)

```bash
# 1. Create a task
TASK_ID=$(curl -s -X POST http://localhost:8080/api/TaskItems \
  -H "Content-Type: application/json" \
  -d '{"title":"New Task","description":"Description"}' \
  | jq -r '.id')

echo "Created task with ID: $TASK_ID"

# 2. Get the task
curl http://localhost:8080/api/TaskItems/$TASK_ID

# 3. Update the task
curl -X PUT http://localhost:8080/api/TaskItems/$TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated Task","description":"Updated description"}'

# 4. Get all tasks
curl http://localhost:8080/api/TaskItems

# 5. Delete the task
curl -X DELETE http://localhost:8080/api/TaskItems/$TASK_ID

# 6. Verify deletion (should return 404)
curl -I http://localhost:8080/api/TaskItems/$TASK_ID
```

### Complete CRUD Workflow (v1 - Recommended)

```bash
# 1. Create a task with status
TASK_ID=$(curl -s -X POST http://localhost:8080/api/v1/TaskItems \
  -H "Content-Type: application/json" \
  -d '{"title":"New Task","description":"Description","statusId":1}' \
  | jq -r '.id')

echo "Created task with ID: $TASK_ID"

# 2. Get the task (includes statusName)
curl http://localhost:8080/api/v1/TaskItems/$TASK_ID

# 3. Update the task with new status
curl -X PUT http://localhost:8080/api/v1/TaskItems/$TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated Task","description":"Updated description","statusId":2}'

# 4. Get all tasks
curl http://localhost:8080/api/v1/TaskItems

# 5. Delete the task
curl -X DELETE http://localhost:8080/api/v1/TaskItems/$TASK_ID

# 6. Verify deletion (should return 404)
curl -I http://localhost:8080/api/v1/TaskItems/$TASK_ID
```

### Status Management Workflow

```bash
# 1. Create a status
STATUS_ID=$(curl -s -X POST http://localhost:8080/api/v1/Status \
  -H "Content-Type: application/json" \
  -d '{"name":"In Review","description":"Task is under review"}' \
  | jq -r '.id')

echo "Created status with ID: $STATUS_ID"

# 2. Get the status
curl http://localhost:8080/api/v1/Status/$STATUS_ID

# 3. Update the status
curl -X PUT http://localhost:8080/api/v1/Status/$STATUS_ID \
  -H "Content-Type: application/json" \
  -d '{"name":"Under Review","description":"Task is being reviewed by the team"}'

# 4. Get all statuses
curl http://localhost:8080/api/v1/Status

# 5. Delete the status
curl -X DELETE http://localhost:8080/api/v1/Status/$STATUS_ID

# 6. Verify deletion (should return 404)
curl -I http://localhost:8080/api/v1/Status/$STATUS_ID
```

### Health Check Workflow

```bash
# Check overall health
curl http://localhost:8080/health | jq '.status'

# Check readiness (database connectivity)
curl http://localhost:8080/health/ready | jq '.status'

# Check liveness (application responsiveness)
curl http://localhost:8080/health/live | jq '.status'

# Get health check details
curl http://localhost:8080/health | jq '.results'
```

## Additional Resources

- [Getting Started Guide](GETTING_STARTED.md) - Setup and local testing
- [Architecture Documentation](ARCHITECTURE.md) - API design and patterns
- [Deployment Guide](DEPLOYMENT.md) - Deploying to different environments

---

[← Back to README](../README.md) | [Getting Started](GETTING_STARTED.md) | [Deployment →](DEPLOYMENT.md)
