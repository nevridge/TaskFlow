// Checks an agent's four-line status block against a pipeline template.
//
//   node check-reply.mjs <template-path> <expected-output-path>   (reply text on standard input)
//
// Exit 0: the block is valid. Exit 1: the reply fails the check. Exit 2: usage error.
// Every non-zero exit prints the problem, the expected value and the received value on standard error.

import fs from 'node:fs';
import process from 'node:process';

// `node --test <directory>` may run this file as a test on some Node versions. It is not a test.
// A test runner passes no arguments; a real call always has two, so it is always checked.
if (process.env.NODE_TEST_CONTEXT && process.argv.length <= 2) process.exit(0);

const LABELS = ['Status', 'Output', 'Open questions', 'Summary'];

function usage(message) {
  process.stderr.write(
    `check-reply: ${message}\nUsage: node check-reply.mjs <template-path> <expected-output-path> (reply on standard input)\n`,
  );
  process.exit(2);
}

function fail(message) {
  process.stderr.write(`check-reply: ${message}\n`);
  process.exit(1);
}

function listLine(template, label) {
  const match = template.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'));
  if (!match) return null;
  return match[1]
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

const args = process.argv.slice(2);
if (args.length !== 2) usage(`expected 2 arguments, got ${args.length}`);
const [templatePath, expectedOutput] = args;

let template;
try {
  template = fs.readFileSync(templatePath, 'utf8');
} catch (error) {
  usage(`cannot read template ${templatePath}: ${error.message}`);
}

const allowed = listLine(template, 'Allowed status');
if (!allowed || allowed.length === 0) usage(`template ${templatePath} has no "Allowed status:" line`);
const noFile = listLine(template, 'No-file status') ?? [];

let reply;
try {
  reply = fs.readFileSync(0, 'utf8');
} catch {
  reply = '';
}

// The block is the first four non-blank lines. Text after them is ignored.
// A line that is only a code fence is skipped, so a block wrapped in a fence is read as the block.
const lines = reply
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !/^```[\w-]*$/.test(line))
  .slice(0, 4);

const values = {};
LABELS.forEach((label, index) => {
  const line = lines[index];
  const prefix = `${label}:`;
  if (line === undefined || !line.startsWith(prefix)) {
    fail(
      `Block line ${index + 1} is wrong: expected a line starting "${prefix}", got ${
        line === undefined ? 'no line' : `"${line}"`
      }. The reply must start with four lines in this order: ${LABELS.map((l) => `${l}:`).join(', ')}`,
    );
  }
  values[label] = line.slice(prefix.length).trim();
});

const status = values.Status;
if (!allowed.includes(status)) {
  fail(`Status ${status || '(empty)'} not in Allowed status: ${allowed.join(', ')}`);
}

if (!/^\d+$/.test(values['Open questions'])) {
  fail(`Open questions is not an integer: expected a whole number such as 0, got "${values['Open questions']}"`);
}

if (values.Summary === '') {
  fail('Summary is empty: expected one line of text, got nothing');
}

const output = values.Output;
if (output === 'none') {
  if (!noFile.includes(status)) {
    fail(
      `Output is none but Status ${status} is not a No-file status: expected Output ${expectedOutput}, or one of the No-file status values (${
        noFile.join(', ') || 'the template lists none'
      }), got Output none with Status ${status}`,
    );
  }
  process.exit(0);
}

if (noFile.includes(status)) {
  fail(`Status ${status} is a No-file status but Output is not none: expected Output none, got ${output || '(empty)'}`);
}

if (output !== expectedOutput) {
  fail(`Output differs: expected ${expectedOutput}, got ${output || '(empty)'}`);
}

let content;
try {
  content = fs.readFileSync(expectedOutput, 'utf8');
} catch (error) {
  fail(`Output file missing: expected a file at ${expectedOutput}, got ${error.code ?? error.message}`);
}

if (content.trim() === '') {
  fail(`Output file empty: expected text in ${expectedOutput}, got ${content.length} characters of whitespace`);
}

process.exit(0);
