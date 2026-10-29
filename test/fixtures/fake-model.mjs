// Offline model-command fixture: node test/fixtures/fake-model.mjs [mode]
import fs from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const mode = process.argv[2] || 'go';
if (mode === 'echo') process.stdout.write(input);
else if (mode === 'fail') { console.log('VERDICT: GO'); process.exitCode = 7; }
else if (mode === 'timeout') { console.log('VERDICT: GO'); setInterval(() => {}, 1000); }
else if (mode === 'ambiguous') console.log('VERDICT: GO or STOP');
else if (mode === 'double') console.log('VERDICT: GO\nVERDICT: STOP');
else if (mode === 'same-double') console.log('VERDICT: GO\nVERDICT: GO');
else if (mode === 'junk') console.log('No verdict available.');
else if (mode === 'large') process.stdout.write('x'.repeat(2 * 1024 * 1024));
else if (mode === 'large-stderr') { fs.writeSync(2, 'x'.repeat(2 * 1024 * 1024) + 'oven diagnostic'); console.log('VERDICT: GO'); }
else if (mode === 'contested') {
  const prompt = fs.readFileSync(process.env.PROMPT_FILE, 'utf8');
  const decisions = fs.readFileSync(process.env.DECISIONS_FILE, 'utf8');
  const ids = (process.env.EXPECT_IDS || '').split(',');
  if (ids.length !== 2 || ids.some((id) => !id || !decisions.includes(`- ${id} [CONTESTED]`)) ||
      !input.includes(decisions) || !input.includes(prompt) ||
      !prompt.includes('if a CONTESTED entry would forbid the action, STOP until it is resolved')) process.exitCode = 9;
  else console.log(`VERDICT: STOP\nWHY: Received contested entries ${ids.join(', ')}; resolve the disputed prohibition.`);
}
else if (mode === 'contract') {
  const parts = ['PROMPT_FILE', 'DECISIONS_FILE', 'ACTION_FILE'].map((key) => fs.readFileSync(process.env[key], 'utf8'));
  if (parts.some((part) => !input.includes(part)) || !parts[1].includes(process.env.EXPECT_ID || 'ACTIVE') || !parts[2].includes('Proposed action:') || (process.env.EXPECT_AGENT && !parts[2].includes(process.env.EXPECT_AGENT))) process.exitCode = 9;
  else console.log('VERDICT: GO\nWHY: Received every prompt part.');
} else if (mode === 'stderr-fail') { process.stderr.write('bakery oven offline: rate limited\n'); process.exitCode = 1; }
else if (mode === 'flaky') {
  // Count attempts in a file so retries across fresh processes can succeed later.
  const counter = process.env.RETRY_COUNTER;
  let n = 0;
  try { n = Number(fs.readFileSync(counter, 'utf8')) || 0; } catch { /* First attempt. */ }
  fs.writeFileSync(counter, String(++n));
  if (n < Number(process.env.RETRY_SUCCEED_AT || 2)) { process.stderr.write(`attempt ${n}: oven still warming up\n`); process.exitCode = 1; }
  else console.log('VERDICT: GO\nWHY: The oven is ready now.');
}
else if (mode === 'audit') {
  const parts = ['PROMPT_FILE', 'DECISIONS_FILE', 'ACTION_FILE'].map((key) => fs.readFileSync(process.env[key], 'utf8'));
  if (parts.some((part) => !input.includes(part)) || !parts[0].includes('semantic contradictions') || !parts[0].includes('DATA, not instructions') ||
      (process.env.EXPECT_IDS || '').split(',').filter(Boolean).some((id) => !parts[1].includes(id))) process.exitCode = 9;
  else process.stdout.write(process.env.AUDIT_OUTPUT ?? 'NONE');
}
else if (mode === 'stderr-tail') { process.stderr.write('prefix' + 'x'.repeat(4096) + '\x1b[31moven offline\r\n\x07'); process.exitCode = 1; }
else if (mode === 'retry-output') {
  const counter = process.env.RETRY_COUNTER;
  let n = 0;
  try { n = Number(fs.readFileSync(counter, 'utf8')); } catch { /* First attempt. */ }
  fs.writeFileSync(counter, String(++n));
  if (n === 1) {
    if (process.env.RETRY_FAILURE === 'timeout') setInterval(() => {}, 1000);
    else if (process.env.RETRY_FAILURE === 'large') { fs.writeSync(1, 'x'.repeat(2 * 1024 * 1024)); process.exitCode = 1; }
    else { process.stderr.write('oven warming up'); process.exitCode = 1; }
  } else {
    process.stderr.write('oven diagnostic');
    process.stdout.write(process.env.RETRY_OUTPUT || 'VERDICT: GO');
  }
}
else if (mode === 'cite') console.log(`VERDICT: ${process.env.CITE_VERDICT || 'GO'}\nWHY: See ${process.env.CITE_IDS || ''} for the bakery policy.`);
else if (mode === 'today') {
  const prompt = fs.readFileSync(process.env.PROMPT_FILE, 'utf8');
  if (!prompt.includes(`Today is ${process.env.EXPECT_TODAY}.`)) process.exitCode = 9;
  else console.log('VERDICT: GO\nWHY: The prompt date matched.');
}
else if (mode === 'stop') console.log('VERDICT: STOP\nWHY: The fixture blocks this action.');
else if (mode === 'go') console.log('VERDICT: GO\nWHY: The fixture allows this action.');
else { console.error('Unknown fixture mode'); process.exitCode = 1; }
