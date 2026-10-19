// `primo-alpine init`: wires islands into an Ex Libris customModule. Safe to run twice.
'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULTS, findProjectRoot } = require('./config');
const { generateAll } = require('./islands');

const MAPPINGS = 'src/app/custom1-module/customComponentMappings.ts';
const APP_MODULE = 'src/app/app.module.ts';
const ASSET_BASE = 'src/app/state/asset-base.generated.ts';

const posix = (p) => p.split(path.sep).join('/');
const importPath = (fromFile, toFile) => {
  const rel = posix(path.relative(path.dirname(fromFile), toFile)).replace(/\.ts$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
};

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  const indent = (/^([ \t]+)"/m.exec(text) || [, '  '])[1];
  return { json: JSON.parse(text), indent, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

function writeJson(file, { json, indent, eol }) {
  fs.writeFileSync(file, JSON.stringify(json, null, indent).replace(/\n/g, eol) + eol);
}

/** Inserts `...islandMappings,` into `new Map<...>([`, plus the import. */
function patchMappings(file, mapFile) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes('islandMappings')) return 'already done';
  const open = /new Map<[^>]*>\(\s*\[/.exec(s);
  if (!open) return null;
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const at = open.index + open[0].length;
  s = `${s.slice(0, at)}${eol}  // Alpine islands (primo-alpine). Entries below with the same slot override them.${eol}  ...islandMappings,${s.slice(at)}`;
  s = `import { islandMappings } from '${importPath(file, mapFile)}';${eol}${s}`;
  fs.writeFileSync(file, s);
  return 'patched';
}

/** Adds `...providePrimoAlpine({...})` after `...providers,` in the NgModule providers. */
function patchAppModule(file, root) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes('providePrimoAlpine')) return 'already done';
  const anchor = /providers:\s*\[\s*\.\.\.providers,/.exec(s);
  if (!anchor) return null;
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const hasAssetBase = fs.existsSync(path.join(root, ASSET_BASE));
  const assetBase = hasAssetBase ? '() => assetBaseUrl' : "() => ''";
  const provider = [
    '',
    '      // Alpine islands: dev mode (and the ?ndeTokens=1 inspector) only on the local dev server.',
    '      ...providePrimoAlpine({',
    "        dev: ['localhost', '127.0.0.1'].includes(location.hostname),",
    `        assetBase: ${assetBase},`,
    '      }),',
  ].join(eol);
  const at = anchor.index + anchor[0].length;
  s = s.slice(0, at) + provider + s.slice(at);
  const imports = [`import { providePrimoAlpine } from '@libis/primo-alpine';`];
  if (hasAssetBase) imports.push(`import { assetBaseUrl } from '${importPath(file, path.join(root, ASSET_BASE))}';`);
  s = imports.join(eol) + eol + s;
  fs.writeFileSync(file, s);
  return 'patched';
}

function addScripts(pkg) {
  const scripts = (pkg.scripts = pkg.scripts || {});
  const changes = [];
  const codegen = 'primo-alpine codegen';
  for (const [hook, base] of [['prebuild', 'build'], ['prestart', 'start'], ['prestart:proxy', 'start:proxy']]) {
    if (!scripts[base]) continue;
    if (scripts[hook]?.includes('primo-alpine')) continue;
    scripts[hook] = scripts[hook] ? `${codegen} && ${scripts[hook]}` : codegen;
    changes.push(hook);
  }
  const extra = {
    'lint:islands': 'primo-alpine lint',
    'islands:watch': 'primo-alpine codegen --watch',
    ...(scripts['start:proxy'] ? { 'start:islands': 'primo-alpine dev -- npm run start:proxy' } : {}),
  };
  for (const [name, cmd] of Object.entries(extra)) {
    if (!scripts[name]) {
      scripts[name] = cmd;
      changes.push(name);
    }
  }
  return changes;
}

function init({ root = findProjectRoot(), registration = 'map' } = {}) {
  const pkgFile = path.join(root, 'package.json');
  const pkg = readJson(pkgFile);
  const report = [];
  const manual = [];

  if (!pkg.json.primoAlpine) {
    pkg.json.primoAlpine =
      registration === 'map'
        ? { islandsDir: DEFAULTS.islandsDir, registration: 'map', mapFile: DEFAULTS.mapFile }
        : { islandsDir: 'src/app/components', registration: 'nde-decorator', cspSafeDirs: ['central'] };
    report.push('package.json: added "primoAlpine" configuration');
  }
  const config = { ...DEFAULTS, ...pkg.json.primoAlpine };

  if (config.registration === 'map') {
    const added = addScripts(pkg.json);
    if (added.length) report.push(`package.json: scripts ${added.join(', ')}`);
  }
  writeJson(pkgFile, pkg);

  const deps = { ...pkg.json.dependencies, ...pkg.json.devDependencies };
  const missing = ['@libis/primo-alpine', '@libis/primo-shared-state', 'alpinejs'].filter((d) => !deps[d]);
  if (missing.length) manual.push(`Install: npm install ${missing.join(' ')} (primo-shared-state may be a local .tgz)`);

  if (config.registration === 'map') {
    const mapFile = path.join(root, config.mapFile);
    fs.mkdirSync(path.join(root, config.islandsDir), { recursive: true });

    const gitignore = path.join(root, '.gitignore');
    const entry = `/${posix(config.mapFile)}`;
    const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
    if (!current.split(/\r?\n/).includes(entry)) {
      const eol = current.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(gitignore, `${current}${current && !current.endsWith('\n') ? eol : ''}# Generated by primo-alpine codegen${eol}${entry}${eol}`);
      report.push(`.gitignore: ${entry}`);
    }

    generateAll({ root, quiet: true });
    report.push(`generated ${posix(config.mapFile)}`);

    const mappings = path.join(root, MAPPINGS);
    const mapped = fs.existsSync(mappings) ? patchMappings(mappings, mapFile) : null;
    if (mapped) report.push(`${MAPPINGS}: ${mapped}`);
    else manual.push(`In your selectorComponentMap, add \`...islandMappings\` (import { islandMappings } from '<path to ${config.mapFile}>').`);

    const appModule = path.join(root, APP_MODULE);
    const provided = fs.existsSync(appModule) ? patchAppModule(appModule, root) : null;
    if (provided) report.push(`${APP_MODULE}: ${provided}`);
    else manual.push("In your root NgModule providers, add `...providePrimoAlpine({ dev: location.hostname === 'localhost', assetBase: () => '<asset base url>' })`.");
  } else {
    manual.push('nde-decorator mode: register PrimoAlpineWebpackPlugin (or run `primo-alpine codegen` before builds) and add providePrimoAlpine() to your root module.');
  }

  console.log('primo-alpine init');
  report.forEach((line) => console.log(`  ✓ ${line}`));
  manual.forEach((line) => console.log(`  ! ${line}`));
  console.log('\nNext: npx primo-alpine generate my-island --slot nde-search-results --position top');
  return { report, manual };
}

module.exports = { init, patchMappings, patchAppModule, addScripts };
