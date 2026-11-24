// Tests for check-reply.mjs. Run from the repo root: node --test .claude/skills/feature-factory/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'check-reply.mjs');
const referencesDir = path.join(here, 'references');

let dir;
let template;
let output;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-reply-'));
  template = path.join(dir, 'template-sample.md');
  output = path.join(dir, 'out.md');
  fs.writeFileSync(
    template,
    [
      '# Template: sample',
      '',
      'Allowed status: DONE, NEEDS_INPUT, NO_UI_WORK, BLOCKED, WRITE_FAILED',
      'No-file status: NO_UI_WORK, BLOCKED, WRITE_FAILED',
      'Precedence: BLOCKED, then NEEDS_INPUT, then DONE.',
      '',
    ].join('\n'),
  );
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Recorded when the test file loads, before any fixture is written, so every fixture is fresh.
const defaultSince = String(Date.now());

// `sinceEnv`: undefined keeps the default CHECK_REPLY_SINCE, null removes it, a string sets it.
function run(reply, args = [template, output], sinceEnv = undefined) {
  // The test runner sets NODE_TEST_CONTEXT for its children; the script exits 0 at once when it
  // sees it, so remove it for the direct CLI call under test.
  const env = { ...process.env, CHECK_REPLY_SINCE: defaultSince };
  delete env.NODE_TEST_CONTEXT;
  if (sinceEnv === null) delete env.CHECK_REPLY_SINCE;
  else if (sinceEnv !== undefined) env.CHECK_REPLY_SINCE = sinceEnv;
  return spawnSync(process.execPath, [script, ...args], { input: reply, encoding: 'utf8', env });
}

function block({ status = 'DONE', out = output, questions = '0', summary = 'wrote the file' } = {}) {
  return [`Status: ${status}`, `Output: ${out}`, `Open questions: ${questions}`, `Summary: ${summary}`].join('\n');
}

function writeOutput(text = '# Report\n\nBody.\n') {
  fs.writeFileSync(output, text);
}

function removeOutput() {
  fs.rmSync(output, { force: true });
}

describe('valid replies exit 0', () => {
  test('four lines in order, allowed status, Output equal to the expected path, file non-empty', () => {
    writeOutput();
    const result = run(block());
    assert.equal(result.status, 0, result.stderr);
  });

  test('Output: none with a No-file status value', () => {
    removeOutput();
    const result = run(block({ status: 'NO_UI_WORK', out: 'none' }));
    assert.equal(result.status, 0, result.stderr);
  });

  test('extra text after the four lines is ignored', () => {
    removeOutput();
    const reply = `${block({ status: 'WRITE_FAILED', out: 'none', summary: 'disk full' })}\n\n## Inline brief\n\nStatus: DONE\nMore text.\n`;
    const result = run(reply);
    assert.equal(result.status, 0, result.stderr);
  });

  test('Windows line endings and a non-zero Open questions count', () => {
    writeOutput();
    const result = run(block({ status: 'NEEDS_INPUT', questions: '3' }).replace(/\n/g, '\r\n'));
    assert.equal(result.status, 0, result.stderr);
  });
});

describe('tolerated formatting exits 0', () => {
  test('CRLF template with extra spaces in the status lists, trailing spaces in the block, and a path with spaces', () => {
    const spaced = path.join(dir, 'dir with spaces');
    fs.mkdirSync(spaced, { recursive: true });
    const crlfTemplate = path.join(spaced, 'template-crlf.md');
    const spacedOutput = path.join(spaced, 'out file.md');
    fs.writeFileSync(crlfTemplate, 'Allowed status:   DONE ,  BLOCKED  \r\nNo-file status:  BLOCKED \r\n');
    fs.writeFileSync(spacedOutput, '# Report\n');

    const reply = `Status: DONE   \r\nOutput: ${spacedOutput}  \r\nOpen questions: 0 \r\nSummary: ok  \r\n`;
    assert.equal(run(reply, [crlfTemplate, spacedOutput]).status, 0);

    const none = 'Status: BLOCKED\r\nOutput: none\r\nOpen questions: 0\r\nSummary: no input\r\n';
    assert.equal(run(none, [crlfTemplate, spacedOutput]).status, 0);
  });

  test('a block wrapped in a code fence', () => {
    writeOutput();
    const result = run(`\`\`\`text\n${block()}\n\`\`\`\n`);
    assert.equal(result.status, 0, result.stderr);
  });
});

describe('invalid replies exit non-zero', () => {
  test('wrong line order', () => {
    writeOutput();
    const reply = [`Output: ${output}`, 'Status: DONE', 'Open questions: 0', 'Summary: swapped'].join('\n');
    const result = run(reply);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected a line starting "Status:"/);
  });

  test('a line of the block is missing', () => {
    writeOutput();
    const reply = ['Status: DONE', `Output: ${output}`, 'Summary: no count'].join('\n');
    const result = run(reply);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Open questions:/);
  });

  test('empty reply', () => {
    const result = run('');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /got no line/);
  });

  test('output file missing', () => {
    removeOutput();
    const result = run(block());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Output file missing/);
    assert.ok(result.stderr.includes(output));
  });

  test('output file zero-length', () => {
    writeOutput('');
    const result = run(block());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Output file empty/);
  });

  test('output file whitespace-only', () => {
    writeOutput(' \n\t\n\n');
    const result = run(block());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Output file empty/);
  });

  test('status not in Allowed status: the message names the received and the allowed values', () => {
    writeOutput();
    const result = run(block({ status: 'GATES_RED' }));
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('GATES_RED'), result.stderr);
    assert.ok(result.stderr.includes('DONE, NEEDS_INPUT, NO_UI_WORK, BLOCKED, WRITE_FAILED'), result.stderr);
  });

  test('status in the wrong case is not allowed', () => {
    writeOutput();
    const result = run(block({ status: 'done' }));
    assert.equal(result.status, 1);
  });

  test('Output differs from the expected path: the message names both paths', () => {
    writeOutput();
    const other = path.join(dir, 'other.md');
    fs.writeFileSync(other, 'text\n');
    const result = run(block({ out: other }));
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(output), result.stderr);
    assert.ok(result.stderr.includes(other), result.stderr);
  });

  test('Output is compared as a raw string, with no path normalisation', () => {
    writeOutput();
    // Another spelling of the same existing file.
    const result = run(block({ out: `${dir}${path.sep}.${path.sep}out.md` }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Output differs/);
  });

  test('Output: none with a status that is not a No-file status value', () => {
    writeOutput();
    const result = run(block({ status: 'DONE', out: 'none' }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a No-file status/);
    assert.ok(result.stderr.includes('NO_UI_WORK, BLOCKED, WRITE_FAILED'), result.stderr);
  });

  test('a No-file status that names the output path, with a stale file there', () => {
    writeOutput();
    const result = run(block({ status: 'BLOCKED' }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is a No-file status but Output is not none/);
  });

  test('Open questions that is not an integer', () => {
    writeOutput();
    for (const questions of ['two', '1.5', '-1', '']) {
      const result = run(block({ questions }));
      assert.equal(result.status, 1, `Open questions: "${questions}"`);
      assert.match(result.stderr, /Open questions is not an integer/);
    }
  });
});

describe('freshness of the output file (CHECK_REPLY_SINCE)', () => {
  const second = 1_700_000_000; // whole second, in epoch seconds
  const since = String(second * 1000 + 500); // partway through that second

  function setMtime(seconds) {
    writeOutput();
    fs.utimesSync(output, seconds, seconds);
  }

  test('a file written after SINCE passes', () => {
    setMtime(second + 10);
    const result = run(block(), undefined, since);
    assert.equal(result.status, 0, result.stderr);
  });

  test('a file modified exactly at the floored SINCE passes', () => {
    setMtime(second);
    const result = run(block(), undefined, since);
    assert.equal(result.status, 0, result.stderr);
  });

  test('same second: a file 400 ms earlier than SINCE passes', () => {
    setMtime(second + 0.1);
    const result = run(block(), undefined, since);
    assert.equal(result.status, 0, result.stderr);
  });

  test('same second: a file one second earlier fails', () => {
    setMtime(second + 0.1 - 1);
    const result = run(block(), undefined, since);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Output file not rewritten in this call/);
  });

  test('a file backdated to an earlier second fails', () => {
    setMtime(second - 60);
    const result = run(block(), undefined, since);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Output file not rewritten in this call/);
  });

  test('SINCE missing, empty, negative, non-numeric or fractional fails and names the variable', () => {
    setMtime(second + 10);
    for (const value of [null, '', '-5', 'abc', '12.5']) {
      const result = run(block(), undefined, value);
      assert.equal(result.status, 1, `CHECK_REPLY_SINCE: ${JSON.stringify(value)}`);
      assert.match(result.stderr, /CHECK_REPLY_SINCE/);
    }
  });

  test('SINCE padded with spaces, in exponent or hex form is not accepted (AC 4: not a plain integer)', () => {
    setMtime(second + 10);
    for (const value of [' 1700000000500', '1700000000500 ', '1e12', '0x10', '+5']) {
      const result = run(block(), undefined, value);
      assert.equal(result.status, 1, `CHECK_REPLY_SINCE: ${JSON.stringify(value)}`);
      assert.match(result.stderr, /CHECK_REPLY_SINCE/);
    }
  });

  test('a missing or empty file is reported as such, whatever SINCE holds', () => {
    removeOutput();
    for (const value of [null, 'abc', since]) {
      const result = run(block(), undefined, value);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Output file missing/);
    }
    setMtime(second - 60);
    writeOutput(' \n');
    fs.utimesSync(output, second - 60, second - 60);
    const empty = run(block(), undefined, null);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /Output file empty/);
  });

  test('a No-file reply passes with SINCE missing or malformed', () => {
    removeOutput();
    for (const value of [null, '', 'abc', '-5']) {
      const result = run(block({ status: 'BLOCKED', out: 'none', summary: 'no input' }), undefined, value);
      assert.equal(result.status, 0, `CHECK_REPLY_SINCE: ${JSON.stringify(value)}: ${result.stderr}`);
    }
  });
});

describe('usage errors exit 2', () => {
  test('wrong argument count', () => {
    assert.equal(run(block(), []).status, 2);
    assert.equal(run(block(), [template]).status, 2);
    assert.equal(run(block(), [template, output, 'extra']).status, 2);
  });

  test('unreadable template', () => {
    const result = run(block(), [path.join(dir, 'no-such-template.md'), output]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot read template/);
  });

  test('template with no Allowed status line', () => {
    const bare = path.join(dir, 'template-bare.md');
    fs.writeFileSync(bare, '# Template: bare\n\nNo-file status: BLOCKED\n');
    const result = run(block(), [bare, output]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Allowed status/);
  });
});

describe('the pipeline templates', () => {
  const names = ['research', 'story', 'brief', 'advisories-ux', 'advisories-claude', 'build', 'verify', 'validation'];
  const files = fs.readdirSync(referencesDir).filter((name) => /^template-.*\.md$/.test(name));

  function values(text, label) {
    const match = text.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'));
    return match ? match[1].split(',').map((value) => value.trim()) : null;
  }

  test('one template exists per run file', () => {
    assert.deepEqual([...files].sort(), names.map((name) => `template-${name}.md`).sort());
  });

  for (const file of files) {
    test(`${file}: status lines hold only uppercase values`, () => {
      const text = fs.readFileSync(path.join(referencesDir, file), 'utf8');
      const allowed = values(text, 'Allowed status');
      assert.ok(allowed && allowed.length > 0, 'no "Allowed status:" line');
      for (const value of allowed) assert.match(value, /^[A-Z_]+$/);

      const noFile = values(text, 'No-file status');
      assert.ok(noFile, 'no "No-file status:" line');
      for (const value of noFile) {
        assert.match(value, /^[A-Z_]+$/);
        assert.ok(allowed.includes(value), `No-file status ${value} is not in Allowed status`);
      }
      for (const value of ['BLOCKED', 'WRITE_FAILED']) {
        assert.ok(allowed.includes(value), `${value} missing from Allowed status`);
        assert.ok(noFile.includes(value), `${value} missing from No-file status`);
      }
    });

    test(`${file}: the script accepts a no-file reply against it`, () => {
      const result = run(block({ status: 'BLOCKED', out: 'none', summary: 'no Output path given' }), [
        path.join(referencesDir, file),
        output,
      ]);
      assert.equal(result.status, 0, result.stderr);
    });
  }
});
