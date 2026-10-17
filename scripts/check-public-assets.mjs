import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const inventory = JSON.parse(readFileSync(join(root, 'public-export.json'), 'utf8'));
const expected = inventory.files.filter((entry) => entry.path.startsWith('public/'));
function walk(at) {
  assert.ok(!lstatSync(join(root, at)).isSymbolicLink(), 'Runtime symlink: ' + at);
  return readdirSync(join(root, at)).flatMap((name) => {
    const path = at + '/' + name;
    const info = lstatSync(join(root, path));
    assert.ok(!info.isSymbolicLink(), 'Runtime symlink: ' + path);
    return info.isDirectory() ? walk(path) : [path];
  });
}
assert.deepEqual(walk('public').sort(), expected.map((entry) => entry.path).sort(), 'Runtime inventory changed');
for (const entry of expected) {
  assert.ok(/^public\/[a-zA-Z0-9_./-]+$/.test(entry.path) && !entry.path.split('/').some((part) => part.startsWith('.')), 'Unsafe runtime path');
  const bytes = readFileSync(join(root, entry.path));
  assert.ok(bytes.length === entry.bytes && createHash('sha256').update(bytes).digest('hex') === entry.sha256, 'Runtime asset changed: ' + entry.path);
}
console.log(JSON.stringify({ pass: true, runtimeFiles: expected.length, scope: 'Exported runtime bytes and inventory only; no private authoring or readiness claim' }));
