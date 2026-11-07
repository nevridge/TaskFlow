// PreToolUse hook for Bash(git *). Exit 2 blocks the call. Best effort, not a security boundary
// (`git -C . push`, `git commit -n` and `git push origin :main` are not matched).
import { execSync } from 'node:child_process'

const currentBranch = () => {
  try {
    return execSync('git branch --show-current', { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// Drop heredoc bodies and quoted strings so flags inside a commit message never match.
const strip = (command) =>
  command
    .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2(?=\s|\)|$)/g, '')
    .replace(/"[^"]*"|'[^']*'/g, '""')

const block = (why) => {
  console.error(`Blocked: ${why}`)
  process.exit(2)
}

let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  const command = strip(JSON.parse(input).tool_input?.command ?? '')
  let branch = currentBranch()

  for (const segment of command.split(/&&|\|\||;|\n|\|/)) {
    const words = segment.trim().split(/\s+/)
    const gi = words.indexOf('git')
    if (gi === -1) continue
    const sub = words[gi + 1]
    const args = words.slice(gi + 2)

    // A checkout or switch earlier in the same command changes the branch the later commit lands on.
    if (sub === 'checkout' || sub === 'switch') {
      const target = args.filter((a) => !a.startsWith('-')).pop()
      branch = target ?? currentBranch()
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
      if (branch === 'main' && positional.length < 2) block('push to main; open a PR instead')
    }
  }
})
