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

function run(reply, args = [template, output]) {
  // The test runner sets NODE_TEST_CONTEXT for its children; the script exits 0 at once when it
  // sees it, so remove it for the direct CLI call under test.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
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

  test('Open questions that is not an integer', () => {
    writeOutput();
    for (const questions of ['two', '1.5', '-1', '']) {
      const result = run(block({ questions }));
      assert.equal(result.status, 1, `Open questions: "${questions}"`);
      assert.match(result.stderr, /Open questions is not an integer/);
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
