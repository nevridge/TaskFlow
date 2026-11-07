// PreToolUse hook for Bash(git *). Exit 2 blocks the call. Best effort, not a security boundary
// (e.g. `git -C . push` is not matched).
import { execSync } from 'node:child_process'

let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  const command = JSON.parse(input).tool_input?.command ?? ''
  const block = (why) => {
    console.error(`Blocked: ${why}`)
    process.exit(2)
  }

  if (/(^|\s)--force(-with-lease)?(\s|=|$)/.test(command)) block('--force is not allowed')
  if (/(^|\s)--no-verify(\s|$)/.test(command)) block('--no-verify is not allowed')

  if (/\bgit\s+commit\b/.test(command)) {
    let branch = ''
    try {
      branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim()
    } catch {}
    if (branch === 'main') block('commit on main; create a feature/ or bugfix/ branch and open a PR')
  }

  if (/\bgit\s+push\b/.test(command)) {
    const targetsMain = /\s(\S+:)?(refs\/heads\/)?main(\s|$)/.test(command)
    let onMain = false
    try {
      onMain = execSync('git branch --show-current', { encoding: 'utf8' }).trim() === 'main'
    } catch {}
    const hasRefspec = /\bgit\s+push\b(\s+-\S+)*\s+\S+\s+\S+/.test(command)
    if (targetsMain || (onMain && !hasRefspec)) block('push to main; open a PR instead')
  }
})
