// run-all.mjs — run every example in order; exits non-zero on the first failure.
// Run: node docs/zk/js/run-all.mjs        (Node ≥ 18, zero dependencies)

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selfTest } from './secp256k1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
selfTest();
console.log('✓ secp256k1.mjs agrees with OpenSSL\n');

const files = readdirSync(here).filter((f) => /^\d\d-.*\.mjs$/.test(f)).sort();
for (const file of files) {
  console.log(`── ${file}`);
  const r = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`✗ ${file} failed`); process.exit(1); }
  console.log();
}
console.log(`all ${files.length} examples passed`);
