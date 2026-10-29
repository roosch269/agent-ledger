// node:test also runs directly, avoiding a child-process pipe per test file.
// Discover every suite; this works on Node 20, 22 and 24 without newer flags.
import fs from 'node:fs';
for (const name of fs.readdirSync(new URL('./', import.meta.url)).filter((name) => name.endsWith('.test.js')).sort()) {
  await import(new URL(name, import.meta.url));
}
