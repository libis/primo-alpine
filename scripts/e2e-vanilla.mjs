#!/usr/bin/env node
// End-to-end check against an untouched Ex Libris customModule:
//   clone → install the packed @libis/primo-alpine (strict peer deps) → primo-alpine init →
//   generate islands → lint → build → assert on the generated code and the bundle.
//
// Usage: node scripts/e2e-vanilla.mjs [--branch <customModule branch>] [--keep]
// The default branch is "e2e.vanillaBranch" in the workspace package.json: the upstream branch
// on the Angular major this primo-alpine major targets.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);

const repo = workspace.e2e?.vanillaRepo ?? 'https://github.com/ExLibrisGroup/customModule.git';
const branch = opt('--branch', workspace.e2e?.vanillaBranch);
if (!branch) throw new Error('No branch: pass --branch or set e2e.vanillaBranch in package.json');

const lib = JSON.parse(fs.readFileSync(path.join(root, 'projects/primo-alpine/package.json'), 'utf8'));
const tgz = path.join(root, 'dist', `libis-primo-alpine-${lib.version}.tgz`);
if (!fs.existsSync(tgz)) throw new Error(`${tgz} not found; run npm run pack first`);
const sharedState = fs.readdirSync(path.join(root, 'vendor')).find((f) => f.startsWith('libis-primo-shared-state'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'primo-alpine-e2e-'));
const run = (cmd, cwd = dir) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
};
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
};

try {
  run(`git clone --depth 1 --branch ${branch} ${repo} .`);
  const angular = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies['@angular/core'];
  const libMajor = lib.version.split('.')[0];
  check(angular.replace(/^[\^~]/, '').startsWith(`${libMajor}.`), `${branch} uses Angular ${angular}, primo-alpine ${lib.version} targets Angular ${libMajor}`);

  run('npm install --no-audit --no-fund');
  // No --legacy-peer-deps: peer ranges must be satisfied by the upstream project as it is.
  fs.copyFileSync(tgz, path.join(dir, path.basename(tgz)));
  fs.copyFileSync(path.join(root, 'vendor', sharedState), path.join(dir, sharedState));
  run(`npm install --no-audit --no-fund ./${path.basename(tgz)} ./${sharedState} alpinejs@${lib.peerDependencies.alpinejs.replace(/^[\^~]/, '')}`);

  run('npx primo-alpine init');
  run('npx primo-alpine init'); // must be idempotent
  const mappings = fs.readFileSync(path.join(dir, 'src/app/custom1-module/customComponentMappings.ts'), 'utf8');
  const appModule = fs.readFileSync(path.join(dir, 'src/app/app.module.ts'), 'utf8');
  check(mappings.split('...islandMappings').length === 2, 'init added ...islandMappings to selectorComponentMap once');
  check(appModule.split('providePrimoAlpine(').length === 2, 'init added providePrimoAlpine() to AppModule once');

  run('npx primo-alpine generate e2e-summary --slot nde-search-results --position top --csp-safe');
  run('npx primo-alpine generate e2e-record --slot nde-record-availability --position bottom');
  const recordDir = path.join(dir, 'src/app/islands/e2e-record');
  fs.writeFileSync(path.join(recordDir, 'template.html'), '<p x-data="e2eRecord" x-text="type"></p>\n');
  fs.writeFileSync(
    path.join(recordDir, 'logic.js'),
    "export default function setup(Alpine) {\n  Alpine.data('e2eRecord', () => ({ get type() { return this.$record?.pnx?.display?.type?.[0] ?? ''; } }));\n}\n",
  );
  const viewDir = path.join(dir, 'src/app/islands/e2e-hidden');
  fs.mkdirSync(viewDir);
  fs.writeFileSync(path.join(viewDir, 'island.json'), JSON.stringify({ selector: 'nde-search-bar', position: 'after', viewPattern: '^NO_SUCH_VIEW' }));
  fs.writeFileSync(path.join(viewDir, 'template.html'), '<p x-data x-text="`not csp safe`"></p>\n');

  run('npx primo-alpine codegen');
  run('npx primo-alpine lint'); // e2e-hidden is not cspSafe: reported, but must not fail

  run('npm run build');

  const generated = fs.readFileSync(path.join(dir, 'src/app/islands/islands.generated.ts'), 'utf8');
  check(/"nde-search-results-top"/.test(generated) && /"nde-record-availability-bottom"/.test(generated), 'generated mappings use the host slot keys');
  const bundle = fs
    .readdirSync(path.join(dir, 'dist'), { recursive: true })
    .filter((f) => String(f).endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(dir, 'dist', String(f)), 'utf8'))
    .join('\n');
  check(bundle.includes('e2e-summary') && bundle.includes('$primo.search.totalResults'), 'bundle contains the island templates');
  check(bundle.includes('e2eRecord'), 'bundle contains logic.js');
  check(bundle.includes('return Object.getPrototypeOf(async function () {}).constructor'), 'bundle contains the async-safe evaluator');
  check(bundle.includes('nde-record-availability'), 'bundle contains the $record resolvers');
} finally {
  if (args.includes('--keep')) console.log(`\nKept ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nprimo-alpine ${lib.version} works in a vanilla ${branch}`);
