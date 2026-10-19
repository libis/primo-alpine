// Island discovery, validation, code generation, watching and scaffolding.
//
// An island is a directory (anywhere under primoAlpine.islandsDir) containing:
//   island.json    { selector, position, priority, viewPattern, cspSafe, description }
//   template.html  Alpine markup
//   logic.js       optional: `export default function setup(Alpine) { Alpine.data(...) }`
//   style.scss     optional
'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');

const POSITIONS = ['before', 'after', 'top', 'bottom', 'replace'];
const DECORATOR_SUFFIX = '.island.component.ts';
const SOURCES = ['island.json', 'template.html', 'logic.js', 'style.scss'];
const SCHEMA = path.join(__dirname, '..', 'island.schema.json');

const posix = (p) => p.split(path.sep).join('/');
const relImport = (fromDir, file) => {
  const rel = posix(path.relative(fromDir, file));
  return rel.startsWith('.') ? rel : `./${rel}`;
};

function findIslands(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  if (fs.existsSync(path.join(dir, 'island.json'))) {
    found.push(dir);
    return found;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      findIslands(path.join(dir, entry.name), found);
    }
  }
  return found.sort();
}

/** The key the NDE host looks up: `<selector>-<position>`, or the bare selector for "replace". */
function slotKey(selector, position) {
  return position === 'replace' ? selector : `${selector}-${position}`;
}

function toPascal(name) {
  return name.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}

/** Reads and validates one island. Throws a readable error listing every problem. */
function readIsland(islandDir, ctx) {
  const name = path.basename(islandDir);
  const rel = posix(path.relative(ctx.root, islandDir));
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${rel}: island directory name must be kebab-case`);

  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(islandDir, 'island.json'), 'utf8'));
  } catch (err) {
    throw new Error(`${rel}/island.json: ${err.message}`);
  }

  const errors = [];
  const known = ['$schema', 'selector', 'position', 'priority', 'viewPattern', 'cspSafe', 'description'];
  for (const key of Object.keys(config)) if (!known.includes(key)) errors.push(`unknown key "${key}"`);
  if (typeof config.selector !== 'string' || !/^nde-[a-z0-9-]+$/.test(config.selector)) errors.push('"selector" must be an nde-* slot');
  if (config.position !== undefined && !POSITIONS.includes(config.position)) errors.push(`"position" must be one of ${POSITIONS.join(', ')}`);
  if (config.priority !== undefined && typeof config.priority !== 'number') errors.push('"priority" must be a number');
  if (config.cspSafe !== undefined && typeof config.cspSafe !== 'boolean') errors.push('"cspSafe" must be a boolean');
  if (config.viewPattern !== undefined) {
    try {
      new RegExp(config.viewPattern);
    } catch (err) {
      errors.push(`"viewPattern" is not a valid regular expression: ${err.message}`);
    }
  }
  const templatePath = path.join(islandDir, 'template.html');
  if (!fs.existsSync(templatePath)) errors.push('template.html is missing');
  if (errors.length) throw new Error(`${rel}/island.json:\n  - ${errors.join('\n  - ')}`);

  const topDir = path.relative(ctx.abs(ctx.config.islandsDir), islandDir).split(path.sep)[0];
  const position = config.position ?? 'after';
  return {
    name,
    dir: islandDir,
    rel,
    config,
    position,
    key: slotKey(config.selector, position),
    priority: config.priority ?? 100,
    cspSafe: config.cspSafe ?? ctx.config.cspSafeDirs.includes(topDir),
    templatePath,
    hasLogic: fs.existsSync(path.join(islandDir, 'logic.js')),
    hasStyle: fs.existsSync(path.join(islandDir, 'style.scss')),
  };
}

/** The component class body shared by both registration modes. */
function componentSource(island, fromDir, className, ndeDecorator) {
  const html = fs.readFileSync(island.templatePath, 'utf8');
  const setupId = `${className}Setup`;
  const lines = [];
  if (island.hasLogic) {
    lines.push('// @ts-ignore -- logic.js is plain JavaScript without typings');
    lines.push(`import ${setupId} from '${relImport(fromDir, path.join(island.dir, 'logic.js'))}';`);
  }
  if (ndeDecorator) lines.push(ndeDecorator);
  lines.push(
    '@Component({',
    `  selector: 'custom-island-${island.name}',`,
    '  standalone: true,',
    "  template: '',",
  );
  if (island.hasStyle) lines.push(`  styleUrls: ['${relImport(fromDir, path.join(island.dir, 'style.scss'))}'],`);
  lines.push(
    '  encapsulation: ViewEncapsulation.None,',
    '})',
    `export class ${className} extends AlpineIsland {`,
    `  static override island = ${JSON.stringify(island.name)};`,
    `  static override slot = ${JSON.stringify(island.config.selector)};`,
  );
  if (island.hasLogic) lines.push(`  static override setup = ${setupId} as (Alpine: AlpineType) => void;`);
  lines.push(`  static override html = ${JSON.stringify(html)};`, '}');
  return lines.join('\n');
}

/** "map" mode: one file with every island plus `islandMappings` for selectorComponentMap. */
function renderMapFile(islands, ctx) {
  const file = ctx.abs(ctx.config.mapFile);
  const dir = path.dirname(file);
  const used = new Set();
  const classes = islands.map((island) => {
    let className = `${toPascal(island.name)}Island`;
    for (let i = 2; used.has(className); i++) className = `${toPascal(island.name)}Island${i}`;
    used.add(className);
    return { island, className };
  });

  const entries = classes.map(({ island, className }) => {
    const parts = [`key: ${JSON.stringify(island.key)}`, `component: ${className}`, `priority: ${island.priority}`];
    if (island.config.viewPattern !== undefined) parts.push(`viewPattern: new RegExp(${JSON.stringify(island.config.viewPattern)})`);
    return `  { ${parts.join(', ')} },`;
  });

  return `// AUTO-GENERATED by \`primo-alpine codegen\` from ${posix(ctx.config.islandsDir)} — DO NOT EDIT.
// Edit each island's island.json, template.html, logic.js or style.scss instead.
import { Component, Type, ViewEncapsulation } from '@angular/core';
import { AlpineIsland, AlpineType } from '@libis/primo-alpine';

${classes.map(({ island, className }) => componentSource(island, dir, className)).join('\n\n')}

interface IslandEntry {
  key: string;
  component: Type<unknown>;
  priority: number;
  viewPattern?: RegExp;
}

const entries: IslandEntry[] = [
${entries.join('\n')}
];

function currentVid(): string {
  return (window as any).__BOOTSTRAP_CFG__?.vid ?? new URLSearchParams(location.search).get('vid') ?? '';
}

/**
 * [slot key, component] pairs for \`selectorComponentMap\`, restricted to islands whose viewPattern
 * matches the current view. When several islands claim one slot, the lowest priority wins.
 */
export const islandMappings: [string, Type<unknown>][] = (() => {
  const vid = currentVid();
  const bySlot = new Map<string, IslandEntry>();
  for (const entry of entries) {
    if (entry.viewPattern && !entry.viewPattern.test(vid)) continue;
    const current = bySlot.get(entry.key);
    if (!current || entry.priority < current.priority) bySlot.set(entry.key, entry);
  }
  return [...bySlot.values()].map((e): [string, Type<unknown>] => [e.key, e.component]);
})();
`;
}

/** "nde-decorator" mode: `<name>.island.component.ts` next to the island (LIBIS NDE_customModule). */
function renderDecoratorFile(island, ctx) {
  const opts = [`selector: ${JSON.stringify(island.config.selector)}`, `position: ${JSON.stringify(island.position)}`];
  if (island.config.priority !== undefined) opts.push(`priority: ${island.config.priority}`);
  if (island.config.viewPattern !== undefined) opts.push(`viewPattern: new RegExp(${JSON.stringify(island.config.viewPattern)})`);
  if (island.config.description !== undefined) opts.push(`description: ${JSON.stringify(island.config.description)}`);
  const decorator = `@NDEComponent({\n  ${opts.join(',\n  ')},\n})`;
  const decoratorImport = ctx.config.decoratorImport.startsWith('.')
    ? relImport(island.dir, ctx.abs(ctx.config.decoratorImport))
    : ctx.config.decoratorImport;

  return `// AUTO-GENERATED by \`primo-alpine codegen\` from ${island.rel}/island.json — DO NOT EDIT.
// Edit island.json, template.html${island.hasLogic ? ', logic.js' : ''}${island.hasStyle ? ', style.scss' : ''} instead.
import { Component, ViewEncapsulation } from '@angular/core';
import { AlpineIsland, AlpineType } from '@libis/primo-alpine';
import { NDEComponent } from '${decoratorImport}';
${componentSource(island, island.dir, `${toPascal(island.name)}Island`, decorator)}
`;
}

function writeIfChanged(file, content) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (existing === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function removeDecoratorOrphans(dir, log) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') removeDecoratorOrphans(full, log);
    else if (entry.name.endsWith(DECORATOR_SUFFIX) && !fs.existsSync(path.join(dir, 'island.json'))) {
      fs.unlinkSync(full);
      log(`removed orphan ${full}`);
    }
  }
}

/**
 * Generates the island components. Invalid islands are reported and skipped, so one broken
 * island does not stop the build. Returns { islands, errors, changed }.
 */
function generateAll({ quiet = false, root } = {}) {
  const ctx = loadConfig(root);
  const log = (msg) => !quiet && console.log(`[primo-alpine] ${msg}`);
  const islandsRoot = ctx.abs(ctx.config.islandsDir);
  const islands = [];
  const errors = [];
  for (const dir of findIslands(islandsRoot)) {
    try {
      islands.push(readIsland(dir, ctx));
    } catch (err) {
      errors.push(err.message);
      console.error(`[primo-alpine] ${err.message}`);
    }
  }

  const seen = new Map();
  for (const island of islands) {
    if (seen.has(island.name)) errors.push(`Two islands are named "${island.name}": ${seen.get(island.name)} and ${island.rel}`);
    seen.set(island.name, island.rel);
  }

  let changed = false;
  if (ctx.config.registration === 'map') {
    const file = ctx.abs(ctx.config.mapFile);
    if (writeIfChanged(file, renderMapFile(islands, ctx))) {
      changed = true;
      log(`generated ${posix(path.relative(ctx.root, file))} (${islands.length} island(s))`);
    }
  } else {
    removeDecoratorOrphans(islandsRoot, log);
    for (const island of islands) {
      const file = path.join(island.dir, `${island.name}${DECORATOR_SUFFIX}`);
      if (writeIfChanged(file, renderDecoratorFile(island, ctx))) {
        changed = true;
        log(`generated ${posix(path.relative(ctx.root, file))}`);
      }
    }
    // An island that failed validation must not keep a stale component around.
    for (const dir of findIslands(islandsRoot)) {
      const name = path.basename(dir);
      const stale = path.join(dir, `${name}${DECORATOR_SUFFIX}`);
      if (!islands.some((i) => i.dir === dir) && fs.existsSync(stale)) fs.unlinkSync(stale);
    }
  }
  return { islands, errors, changed, ctx };
}

/** Watches island sources and regenerates on change. Returns a function that stops watching. */
function watch({ root, onChange } = {}) {
  const ctx = loadConfig(root);
  const islandsRoot = ctx.abs(ctx.config.islandsDir);
  fs.mkdirSync(islandsRoot, { recursive: true });
  let timer;
  const generatedName = path.basename(ctx.config.mapFile);
  const watcher = fs.watch(islandsRoot, { recursive: true }, (_event, filename) => {
    const base = filename ? path.basename(String(filename)) : '';
    if (base && !SOURCES.includes(base)) return; // ignores generated files, so no loops
    if (base === generatedName) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const result = generateAll({ root: ctx.root });
      onChange?.(result);
    }, 100);
  });
  console.log(`[primo-alpine] watching ${posix(path.relative(ctx.root, islandsRoot))}`);
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/**
 * Optional webpack plugin for projects that build with webpack: regenerates before every
 * (watch) compilation and makes webpack watch template.html, which is inlined, not imported.
 * Register it before any plugin that discovers *.component.ts files.
 */
class PrimoAlpineWebpackPlugin {
  constructor(options = {}) {
    this.root = options.root;
  }
  apply(compiler) {
    const run = (_, callback) => {
      try {
        generateAll({ quiet: true, root: this.root });
      } catch (err) {
        console.error('[primo-alpine]', err);
      }
      callback();
    };
    compiler.hooks.beforeRun.tapAsync('PrimoAlpineWebpackPlugin', run);
    compiler.hooks.watchRun.tapAsync('PrimoAlpineWebpackPlugin', run);
    compiler.hooks.afterCompile.tap('PrimoAlpineWebpackPlugin', (compilation) => {
      const ctx = loadConfig(this.root);
      const islandsRoot = ctx.abs(ctx.config.islandsDir);
      for (const dir of findIslands(islandsRoot)) {
        for (const f of SOURCES) {
          const full = path.join(dir, f);
          if (fs.existsSync(full)) compilation.fileDependencies.add(full);
        }
      }
      compilation.contextDependencies.add(islandsRoot);
    });
  }
}

/** `primo-alpine generate <name>`: scaffolds island.json, template.html and style.scss. */
function scaffoldIsland(name, { slot = 'nde-search-bar', position = 'after', dir = '', cspSafe, root } = {}) {
  const ctx = loadConfig(root);
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Island name must be kebab-case, e.g. search-summary');
  if (!POSITIONS.includes(position)) throw new Error(`--position must be one of ${POSITIONS.join(', ')}`);
  const selector = slot.startsWith('nde-') ? slot : `nde-${slot}`;
  const islandDir = path.join(ctx.abs(ctx.config.islandsDir), dir, name);
  if (fs.existsSync(islandDir)) throw new Error(`${posix(path.relative(ctx.root, islandDir))} already exists`);
  fs.mkdirSync(islandDir, { recursive: true });

  const schemaInNodeModules = path.join(ctx.root, 'node_modules', '@libis', 'primo-alpine', 'island.schema.json');
  const config = { $schema: posix(path.relative(islandDir, fs.existsSync(schemaInNodeModules) ? schemaInNodeModules : SCHEMA)), selector, position };
  if (cspSafe !== undefined) config.cspSafe = cspSafe;
  fs.writeFileSync(path.join(islandDir, 'island.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(
    path.join(islandDir, 'template.html'),
    `<div class="${name}" x-data="{ open: true }" x-show="open">
  <span x-text="$primo.search.totalResults"></span> results
  <button type="button" @click="open = false">Hide</button>
</div>
`,
  );
  fs.writeFileSync(
    path.join(islandDir, 'style.scss'),
    `// Scoped to this island. Use host design tokens, never host component classes.
[data-island='${name}'] {
  .${name} {
    color: var(--mat-sys-on-surface);
    background: var(--mat-sys-surface-container);
    font: var(--sys-body-medium);
  }
}
`,
  );
  generateAll({ root: ctx.root });
  console.log(`✓ Created island ${posix(path.relative(ctx.root, islandDir))}`);
  console.log(`  Slot: ${slotKey(selector, position)}`);
  return islandDir;
}

module.exports = {
  POSITIONS,
  SOURCES,
  findIslands,
  readIsland,
  slotKey,
  generateAll,
  watch,
  scaffoldIsland,
  PrimoAlpineWebpackPlugin,
  renderMapFile,
  renderDecoratorFile,
};
