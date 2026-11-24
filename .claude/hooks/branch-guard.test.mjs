import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const guard = fileURLToPath(new URL('./branch-guard.mjs', import.meta.url))

// The branch is injected, so these tests never depend on the checkout's real branch.
const runRaw = (stdin, branch) =>
  spawnSync(process.execPath, [guard], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, BRANCH_GUARD_BRANCH: branch },
  })

const run = (toolName, command, branch) =>
  runRaw(JSON.stringify({ tool_name: toolName, tool_input: { command } }), branch)

const blocked = (toolName, command, branch) => {
  const r = run(toolName, command, branch)
  assert.equal(r.status, 2, `expected block for: ${command}\n${r.stderr}`)
  assert.match(r.stderr, /^Blocked: /)
}
const allowed = (toolName, command, branch) => {
  const r = run(toolName, command, branch)
  assert.equal(r.status, 0, `expected allow for: ${command}\n${r.stderr}`)
}

const MAIN = 'main'
const FEATURE = 'feat/x'

for (const tool of ['Bash', 'PowerShell']) {
  test(`${tool}: commit on main is blocked, on a feature branch allowed`, () => {
    blocked(tool, 'git commit -m "x"', MAIN)
    allowed(tool, 'git commit -m "x"', FEATURE)
  })

  test(`${tool}: --no-verify is blocked`, () => {
    blocked(tool, 'git commit --no-verify -m "x"', FEATURE)
    blocked(tool, 'git push --no-verify origin feat/x', FEATURE)
  })

  test(`${tool}: force flags are blocked`, () => {
    for (const flag of ['--force', '--force-with-lease', '--force-if-includes', '-f']) {
      blocked(tool, `git push ${flag} origin feat/x`, FEATURE)
    }
  })

  test(`${tool}: push to main, :main, +refspec and HEAD on main are blocked`, () => {
    blocked(tool, 'git push origin main', FEATURE)
    blocked(tool, 'git push origin :main', FEATURE)
    blocked(tool, 'git push origin +feat/x', FEATURE)
    blocked(tool, 'git push origin HEAD', MAIN)
    blocked(tool, 'git push -u origin HEAD', MAIN)
  })

  test(`${tool}: push of a feature branch is allowed`, () => {
    allowed(tool, 'git push origin feat/x', FEATURE)
    allowed(tool, 'git push -u origin HEAD', FEATURE)
  })

  test(`${tool}: a quoted message that mentions git commit is not blocked`, () => {
    allowed(tool, 'echo "git commit --no-verify"', MAIN)
  })

  test(`${tool}: a failed commit later in a chain is still caught`, () => {
    blocked(tool, 'git status ; git commit -m "x"', MAIN)
  })
}

test('PowerShell: ; separates commands and git.exe is recognised', () => {
  blocked('PowerShell', 'Get-Date; git commit -m "x"', MAIN)
  blocked('PowerShell', 'git.exe commit -m "x"', MAIN)
  blocked('PowerShell', 'git.exe push --force origin feat/x', FEATURE)
})

test('PowerShell: a backtick continuation is joined before the split', () => {
  blocked('PowerShell', 'git push origin feat/x `\n  --force', FEATURE)
  blocked('PowerShell', 'git push `\r\n  --force-with-lease origin feat/x', FEATURE)
  blocked('PowerShell', 'git push origin feat/x `\n  -f', FEATURE)
  blocked('PowerShell', 'git push --force-if-includes `\n origin feat/x', FEATURE)
  allowed('PowerShell', 'git push origin `\n  feat/x', FEATURE)
})

test('PowerShell: a here-string body that mentions git commit is not blocked', () => {
  allowed('PowerShell', "git log --format=%s\n$m = @'\ngit commit -m x\n'@", MAIN)
  allowed('PowerShell', '$m = @"\ngit commit --no-verify\n"@\nWrite-Output $m', MAIN)
  blocked('PowerShell', "$m = @'\ngit commit\n'@\ngit commit -F x", MAIN)
})

test('Bash: a heredoc body that mentions git commit is not blocked', () => {
  allowed('Bash', "cat <<'EOF'\ngit commit -m x\nEOF", MAIN)
})

test('Bash: a git commit chained after && on main is blocked', () => {
  blocked('Bash', 'git add -A && git commit -m "x"', MAIN)
})

test('Bash: a checkout of a new branch in the same command lands the commit off main', () => {
  allowed('Bash', 'git checkout -b feat/y && git commit -m "x"', MAIN)
})

test('bad payloads exit 0 with a one-line warning', () => {
  for (const stdin of ['', 'not json', '{', '{}', '{"tool_input":{}}', '{"tool_input":{"command":""}}']) {
    const r = runRaw(stdin, MAIN)
    assert.equal(r.status, 0, `input: ${JSON.stringify(stdin)}`)
    assert.match(r.stderr, /^branch-guard: .+\n$/)
  }
})
