// PreToolUse hook for Bash(git *) and PowerShell(git *). Exit 2 blocks the call.
// Best effort, not a security boundary, and it fails open: an unreadable payload exits 0 with a warning.
// It judges the branch of the hook's working directory, so a command that targets another repo
// (`cd ../other && git commit`, `git -C ../other commit`) is not covered; neither are
// `git -C . push`, `git commit -n` and a PowerShell call-operator call with a full path
// (`& "C:\...\git.exe" commit`).
// BRANCH_GUARD_BRANCH replaces `git branch --show-current`; the tests use it.
import { execSync } from 'node:child_process'

const currentBranch = () => {
  if (process.env.BRANCH_GUARD_BRANCH !== undefined) return process.env.BRANCH_GUARD_BRANCH
  try {
    return execSync('git branch --show-current', { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// Drop here-doc / here-string bodies and quoted strings so flags inside a commit message never match.
// PowerShell input then joins backtick line continuations; quotes go first, so a backtick inside a
// string cannot change the join.
const strip = (command, powershell) => {
  let out = powershell
    ? command.replace(/@(['"])[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*\1@/g, '')
    : command.replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2(?=\s|\)|$)/g, '')
  out = out.replace(/"[^"]*"|'[^']*'/g, '""')
  return powershell ? out.replace(/`[ \t]*\r?\n/g, ' ') : out
}

const block = (why) => {
  console.error(`Blocked: ${why}`)
  process.exit(2)
}

let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    payload = null
  }
  const raw = payload?.tool_input?.command
  if (typeof raw !== 'string' || raw.trim() === '') {
    console.error('branch-guard: no command in the hook payload; not checked')
    process.exit(0)
  }

  const command = strip(raw, /powershell/i.test(payload.tool_name ?? ''))
  let branch = currentBranch()

  for (const segment of command.split(/&&|\|\||;|\n|\|/)) {
    const words = segment.trim().split(/\s+/)
    const gi = words.findIndex((w) => w === 'git' || w === 'git.exe')
    if (gi === -1) continue
    const sub = words[gi + 1]
    const args = words.slice(gi + 2)

    // A checkout or switch earlier in the same command changes the branch the later commit lands on.
    if (sub === 'checkout' || sub === 'switch') {
      const create = args.findIndex((a) => /^-[bBcC]$/.test(a))
      const beforePaths = args.slice(0, args.indexOf('--') === -1 ? args.length : args.indexOf('--'))
      const positional = beforePaths.filter((a) => !a.startsWith('-'))
      if (create !== -1) branch = args[create + 1] ?? currentBranch()
      else if (positional.length === 1 && positional[0] === 'main') branch = 'main'
      else if (sub === 'switch' && positional.length === 1) branch = positional[0]
      else branch = currentBranch()
      continue
    }

    if (sub === 'commit') {
      if (args.includes('--no-verify')) block('--no-verify is not allowed')
      if (branch === 'main') block('commit on main; create a branch and open a PR')
    }

    if (sub === 'push') {
      if (args.some((a) => /^--force(-with-lease|-if-includes)?(=|$)/.test(a) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a))) {
        block('force-push is not allowed')
      }
      if (args.includes('--no-verify')) block('--no-verify is not allowed')
      const positional = args.filter((a) => !a.startsWith('-'))
      if (positional.some((a) => a.startsWith('+'))) block('force-push (+refspec) is not allowed')
      if (positional.some((a) => /(^|:)(refs\/heads\/)?main$/.test(a))) block('push to main; open a PR instead')
      if (branch === 'main' && (positional.length < 2 || positional.slice(1).includes('HEAD'))) {
        block('push to main; open a PR instead')
      }
    }
  }
})
