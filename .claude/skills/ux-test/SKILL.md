---
name: ux-test
description: "Drives the live TaskFlow dev stack (http://localhost:3000) via Playwright to verify the UI/UX behaviour described in a PR or issue. Reads the PR/issue body with gh, rebuilds the Docker stack, seeds uxtest- fixtures through /api/v1, runs a numbered test plan step by step, posts one idempotent pass/fail comment (marker <!-- ux-test-results -->), then removes fixtures, screenshots and temp files. Invoke: /ux-test PR#228, /ux-test #228, /ux-test PR#250 #228."
when_to_use: "Trigger phrases: 'run UX tests', 'test the UI', 'verify the frontend', 'check the UI changes', 'run ux-test', 'test this PR', 'verify UI changes'."
argument-hint: "[PR#N] [#N]"
disable-model-invocation: true
allowed-tools: >-
  mcp__plugin_playwright_playwright__browser_navigate,
  mcp__plugin_playwright_playwright__browser_snapshot,
  mcp__plugin_playwright_playwright__browser_click,
  mcp__plugin_playwright_playwright__browser_take_screenshot,
  mcp__plugin_playwright_playwright__browser_fill_form,
  mcp__plugin_playwright_playwright__browser_type,
  mcp__plugin_playwright_playwright__browser_console_messages,
  mcp__plugin_playwright_playwright__browser_wait_for,
  mcp__plugin_playwright_playwright__browser_press_key,
  mcp__plugin_playwright_playwright__browser_evaluate,
  mcp__plugin_playwright_playwright__browser_network_requests,
  mcp__plugin_playwright_playwright__browser_resize,
  mcp__plugin_playwright_playwright__browser_select_option,
  Edit(/.playwright-mcp/**),
  Bash(gh pr view *),
  Bash(gh issue view *),
  Bash(GH_TOKEN="$(gh auth token --user nevridge)" gh api *),
  Bash(GH_TOKEN="$(gh auth token --user nevridge)" gh issue comment *),
  Bash(GH_TOKEN="$(gh auth token --user nevridge)" gh pr comment *),
  Bash(GH_TOKEN="$(gh auth token --user nevridge)" gh repo view *),
  Bash(gh auth token --user nevridge),
  Bash(docker compose up -d --build),
  Bash(docker compose ps *),
  Bash(docker compose logs *),
  Bash(docker compose stop taskflow-api),
  Bash(docker compose start taskflow-api),
  Bash(curl *localhost:3000*),
  Bash(git branch --show-current),
  Bash(git rev-parse *),
  Bash(git status --short *),
  Bash(rm -f .playwright-mcp/ux-test-step*.png),
  Bash(rm -f .playwright-mcp/ux-test-results-*.md),
  Bash(rm -f .playwright-mcp/page-*.yml),
  Bash(rm -f .playwright-mcp/console-*.log)
---

You are the UX test driver for TaskFlow. Your role is to verify UI/UX behavior described in a PR or issue by driving the live Docker dev stack via Playwright against the real API, executing a scoped test plan, and posting a structured pass/fail summary as a GitHub comment.

Run `gh`, `docker`, `git` and `curl` only through the Bash tool, never PowerShell. Every `.playwright-mcp/` path below is relative to the repository root. The `Edit(/.playwright-mcp/**)` grant is the only file-write grant and also covers the Write tool for the report file; if Write prompts anyway, a `Write(/.playwright-mcp/**)` entry can be added to the allowed tools.

**Cleanup (Step 11) runs on EVERY exit path**: early stops, failed steps, failed `gh` writes and normal completion. Whenever a step below says "stop", print the stop message, then go to Step 11.

---

## Step 0 - Parse arguments and preflight

Parse the user's input:
- `PR#N` gives the PR number
- `#N` or `N` gives the issue number
- `PR#N #M` gives both
- No arguments: ask once, "What PR or issue should I test? Provide a PR number, issue number, or both (e.g., `PR#250 #228`)." Stop if the answer is not a number.

Keep these identifiers for the whole run. Then:

1. Generate the run id with Bash: `RUN_ID=uxtest-$(date +%Y%m%d%H%M%S)` and print it. Every fixture this run creates is prefixed `<RUN_ID>-`.
2. Record `git branch --show-current`, `git rev-parse --short HEAD` and `git status --short -- . ':(exclude).playwright-mcp'`. A non-empty status is a dirty-tree note for the report. Do not stop on a dirty tree.
3. Sweep stale local files from a crashed earlier run, using only these forms: `rm -f .playwright-mcp/ux-test-step*.png` and `rm -f .playwright-mcp/ux-test-results-*.md`.

---

## Step 1 - Fetch context from GitHub

For each identifier:
- PR: `gh pr view <N> --json title,body,number,headRefName,closingIssuesReferences`
- Issue: `gh issue view <N> --json title,body,number`

If a PR was given without an issue, `closingIssuesReferences` may link an issue; keep it for Step 10 (the list may be empty or missing, which means no linked issue).

If any `gh` read errors (404, permission, network), stop with `gh read failed: <exact error>`. Post nothing. Go to Step 11.

---

## Step 2 - Branch check

- If a PR was given and its `headRefName` differs from the `git branch --show-current` value from Step 0, stop with: `Checked-out branch X is not PR branch Y; check out Y and re-run`. Do this before any `docker` call. Never run `git checkout` or switch branches yourself.
- Issue-only: proceed. The recorded SHA is the evidence of what was tested.

---

## Step 3 - Rebuild and start the dev stack

Run `docker compose up -d --build` so the checked-out working tree is what runs, not a stale image.

If it fails (build error, Docker daemon not running, etc.), stop with `Docker build/start failed` followed by the command output. Go to Step 11.

Never edit `docker-compose.yml`. Never read or depend on `docker-compose.override.yml`.

---

## Step 4 - Verify reachability

Poll every 3 seconds for up to 120 seconds:
- `docker compose ps` to see container status.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/Projects` until it returns `200`. This goes through the web proxy, so it proves the web container and the API are both up.

Then call Playwright `browser_navigate` to `http://localhost:3000` and take a `browser_snapshot`.

- If the 120 seconds elapse, stop with `App not reachable at http://localhost:3000 after 120s`, include the last `docker compose ps` output and `docker compose logs --tail 50`. Go to Step 11.
- If any Playwright tool call fails as not-found or unavailable, stop with `Playwright unavailable. Ensure the Playwright plugin is configured and running.` Go to Step 11.

There is no login step: TaskFlow has no authentication. Never wait for the user at this point.

---

## Step 5 - Sweep leftover fixtures

A crashed earlier run may have left `uxtest-` data behind. List everything through the proxy:

```bash
curl -s http://localhost:3000/api/v1/Projects
curl -s http://localhost:3000/api/v1/TaskItems
```

Both list endpoints take no paging, filter or query parameters and return everything: `/Projects` includes archived projects (`isArchived`), and `/TaskItems` includes completed tasks and subtasks (`parentTaskItemId` is non-null for subtasks). No extra parameter is needed.

Delete every project whose `name` and every task whose `title` starts with `uxtest-` (any run id), in this order:
1. Subtasks (tasks with a `parentTaskItemId`): `curl -s -X DELETE http://localhost:3000/api/v1/TaskItems/<id>`
2. Parent tasks (same call). Deleting a parent that still has children returns 422 `TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN`.
3. Projects: `curl -s -X DELETE http://localhost:3000/api/v1/Projects/<id>`

Report the swept count.

---

## Step 6 - Derive the test plan

Read the PR and/or issue body from Step 1. Generate a numbered test plan from that body ONLY:

1. **Happy path:** the main workflow described. What should the user do and see?
2. **Key edge cases:** states or inputs named in the acceptance criteria (empty list, error state, validation, keyboard behaviour, focus, `aria-busy`, tab order).
3. **Regression risks:** if shared components (layout, routing, navigation) changed, steps that verify those areas still work.
4. **Outcome verification (required for any state-changing feature):** for every create, update, delete, cancel or status-change flow in scope, include a step that **completes** the action (clicks the final confirm) and a following step that verifies the resulting state (row gone, badge changed, value correct after reload). Opening a dialog and dismissing it verifies the affordance, not the behaviour; dismiss paths are fine as edge cases but never substitute for a completion step. The stack is a local dev instance with seeded fixtures, so destructive flows are in scope and must be carried through.

**Constraint:** only test features and flows described in the PR/issue body. Do not test other areas.

Then **map acceptance criteria to steps**: enumerate every AC in the body and map each to a step number, for example:

```
AC1 -> step 4
AC2 -> step 6
AC5 -> not verifiable via UI (rollback-on-error needs a unit test)
```

Any AC with no step must either get one or be declared **not verifiable via UI** with a reason. Rollback-on-error, double-submit races, cache invalidation and query-key behaviour generally belong in unit tests. A body with no testable UI criteria still produces a plan of zero steps and a report with every AC "not verifiable via UI"; that report is still posted.

Add a **fixtures** sub-list: what will be seeded (every name or title prefixed `<RUN_ID>-`) and which steps are API-driven.

Navigation hints: routes are `/`, `/journal/:date` (date format MM-DD-YYYY), `/tasks`, `/tasks/:id`, `/projects`, `/projects/:id`.

Print the plan, the AC map and the fixtures list to the user.

---

## Step 7 - Seed fixtures

Seed only what the plan needs, through `curl` to `http://localhost:3000/api/v1/...` ONLY. Never use the host API ports (8080 or 8081): 8080 is occupied by another app on this machine and the host API port may be remapped. The web proxy at 3000 is always the right base URL.

Fixtures (create only those the plan uses):
- Projects: `<RUN_ID>-active-1`, `<RUN_ID>-active-2`, and `<RUN_ID>-archived`.
  - Create: `curl -s -X POST http://localhost:3000/api/v1/Projects -H 'Content-Type: application/json' -d '{"name":"<RUN_ID>-active-1"}'`
  - Archive by full-replace PUT (name and description are overwritten, so resend them): `curl -s -X PUT http://localhost:3000/api/v1/Projects/<id> -H 'Content-Type: application/json' -d '{"name":"<RUN_ID>-archived","isArchived":true}'`
- Tasks titled `<RUN_ID>-<label>`, with and without `projectId`: `curl -s -X POST http://localhost:3000/api/v1/TaskItems -H 'Content-Type: application/json' -d '{"title":"<RUN_ID>-<label>","status":"Todo","priority":"Medium","projectId":<id>}'`

Rules:
- Enum values are PascalCase strings: status `"Todo"`/`"Completed"`, priority `"Low"`/`"Medium"`/`"High"`.
- Names and titles are at most 100 characters, so the prefix plus label must fit.
- Do not create a task on a past journal day (`journalDate` before the user's today is rejected with 422).
- One level of nesting only: a subtask's parent must not itself be a subtask.
- Quote JSON for `curl -d` with single quotes. Use forward-slash paths.
- Record every created id so cleanup is exact.

Steps the UI cannot produce (for example deleting a project, which keeps its tasks and clears their project) go through the API and are listed in the report as API-driven.

---

## Step 8 - Execute the test plan

Run each step in order. For each step:

1. **Log first:** output `Step N: [description]`.
2. **Perform it** with the Playwright tools (navigate, click, fill, type, press key, wait, select).
3. **Capture evidence:** `browser_take_screenshot` saved to `.playwright-mcp/ux-test-step<N>-<short-description>.png` (never the repo root). If the step involved a submit or navigation, also capture `browser_console_messages`.
4. **Record the result:**
   - `[✓ PASS]` the step achieved its expected result with no unexpected errors.
   - `[✗ FAIL]` it did not, or an error or unexpected state appeared.
   - `[– SKIP]` it was skipped (feature absent, prerequisite failed).
5. **Log the result:** `Step N: [✓/✗/–] [what happened]`.

Continue unless a FAIL is a prerequisite for later steps; those may be skipped with a reason.

State-changing features must be carried through to completion, never dismiss-only.

**API-stopped steps** (testing behaviour when the API is down): run `docker compose stop taskflow-api`, observe the UI, then IMMEDIATELY run `docker compose start taskflow-api` and re-poll the Step 4 `curl` check until `200` before any later step runs. Cleanup also begins with an ensure-API-running check, so a mid-step crash never leaves the API stopped.

---

## Step 9 - Compile results

Produce the report:

```
<!-- ux-test-results -->
## UX Test Results

**PR:** #N | **Issue:** #M (as applicable)
**Branch:** <branch> | **SHA:** <short sha> | **Working tree:** <clean, or dirty note>
**Run:** <RUN_ID> | **Date:** <ISO date>

### Summary
**Total steps:** X | **Passed:** Y | **Failed:** Z | **Skipped:** W

### Passed Steps
- [✓] Step N: description

### Failed Steps
- [✗] Step N: description
  - Error: what went wrong
  - Console errors: relevant lines, if any

### Skipped Steps
- [–] Step N: description
  - Reason: why skipped

### Acceptance Criteria Coverage

| AC | Statement | Status | Evidence |
|----|-----------|--------|----------|
| AC1 | one-line statement | Verified | Step 4 |
| AC5 | one-line statement | Not verifiable via UI | Rollback path, needs a unit test |
| AC7 | one-line statement | Not verified | No step exercised this |

### Fixtures and API-driven steps
- Seeded: ...
- API-driven steps: ... (or "none")
```

The AC coverage table is mandatory and its three statuses are the only ones permitted:
- **Verified**: a specific numbered step in THIS run exercised it and passed. Cite the step. No step, no Verified.
- **Not verified**: no step exercised it, or the step that did failed. Correct even when the code plainly looks right.
- **Not verifiable via UI**: cannot be observed in a browser. State what would cover it instead.

Never infer an AC from reading source, from the PR description, or from an implementation detail you noticed. A run that verifies affordances but never completes the underlying action reports those ACs as Not verified.

Screenshots cannot be embedded in GitHub comments. Refer to steps by number and description, and quote console excerpts inline. State that screenshots are local-only and are deleted at cleanup. Never put local file paths in the comment.

---

## Step 10 - Post results to GitHub

**Target precedence:**
1. The issue, if one was given, or `closingIssuesReferences[0]` when only a PR was given (handle an empty or missing list).
2. Otherwise the PR.
3. Otherwise print the report to the conversation only.

If a PR and an issue are both given, post once, to the issue.

1. Write the report with the Write tool to `.playwright-mcp/ux-test-results-<RUN_ID>.md`. The first line must be exactly `<!-- ux-test-results -->`.
2. Look for an existing results comment (PR conversation comments use the same issues endpoint). No grep pipe is needed; the filter matches only this skill's own marker, so a `<!-- ux-checklist -->` comment from feature-factory Step 10.5 is never touched:
   ```bash
   GH_TOKEN="$(gh auth token --user nevridge)" gh api --paginate "repos/{owner}/{repo}/issues/<N>/comments" --jq '.[] | select(.body | startswith("<!-- ux-test-results -->")) | .id'
   ```
3. If one or more ids come back, update the first:
   ```bash
   GH_TOKEN="$(gh auth token --user nevridge)" gh api -X PATCH "repos/{owner}/{repo}/issues/comments/<id>" -F body=@.playwright-mcp/ux-test-results-<RUN_ID>.md
   ```
4. Otherwise create it:
   ```bash
   GH_TOKEN="$(gh auth token --user nevridge)" gh issue comment <N> --body-file .playwright-mcp/ux-test-results-<RUN_ID>.md
   ```
   (or `gh pr comment <N> --body-file ...` with the same token prefix when the target is the PR).

Never use inline `--body`.

If any `gh` write fails: print the full report to the conversation, report the exact error, go to Step 11, and stop. Do not retry, do not try another account, never run `gh auth switch`.

---

## Step 11 - Cleanup (every exit path)

1. If the stack was started and the API may be stopped, ensure it is running: `docker compose ps`, and `docker compose start taskflow-api` if needed. Re-poll the Step 4 `curl` check.
2. If seeding had started, delete this run's fixtures by recorded id (or by the `<RUN_ID>-` prefix from the list calls in Step 5): subtasks first, then parent tasks, then projects.
3. Delete local files, using only these forms:
   ```bash
   rm -f .playwright-mcp/ux-test-step*.png
   rm -f .playwright-mcp/ux-test-results-*.md
   rm -f .playwright-mcp/page-*.yml
   rm -f .playwright-mcp/console-*.log
   ```
   Missing files are not an error. Assume any `page-*.yml` and `console-*.log` in `.playwright-mcp/` are Playwright output from this run. Never remove the `.playwright-mcp` directory itself.
4. A cleanup error is reported to the user but never hides the results. Finish with `Cleanup complete.` (or the error).

---

## Guardrails and Invariants

- **Only target `http://localhost:3000`.** Never `taskflow.skalaforge.com` or any non-localhost URL.
- **Never edit `docker-compose.yml`**, and never read or depend on `docker-compose.override.yml`.
- **No login step.** TaskFlow has no authentication; never wait for the user mid-run.
- **Never run `gh auth switch`.** Use the per-command `GH_TOKEN="$(gh auth token --user nevridge)"` prefix only for `gh` writes and `gh api`; read-only `gh pr view` / `gh issue view` run without it.
- **Always `--body-file`** (or `-F body=@file` for PATCH). Never inline `--body`.
- **`gh`, `docker`, `git` and `curl` always go through the Bash tool**, never PowerShell.
- **Scope is strict.** Test only what the PR/issue describes. The plan comes from the PR/issue body only.
- **State-changing features are carried through to completion.** A dismissed dialog is not a tested mutation.
- **An AC is Verified only with a passing numbered step from this run.** Never from reading source.
- **PascalCase enum values** in every API payload and comparison.
- **Re-running is idempotent.** A second run updates the existing `<!-- ux-test-results -->` comment instead of adding another.
