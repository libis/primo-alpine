// `primo-alpine lint`: checks every directive expression against Alpine's own CSP parser.
'use strict';

const fs = require('fs');
const path = require('path');
const { generateAll } = require('./islands');

// Attributes whose value is not a JavaScript expression.
const NON_EXPRESSION = /^x-(ref|cloak|ignore|transition(:|\.|$)|teleport|asset-src|intersect\.|mask$)/;
// Browser globals the CSP build refuses to touch. (The runtime check covers every global; these
// are the ones that show up in templates in practice.)
const PROHIBITED_GLOBALS = new Set([
  'window', 'document', 'globalThis', 'self', 'top', 'parent', 'console', 'localStorage', 'sessionStorage',
  'location', 'navigator', 'history', 'fetch', 'alert', 'confirm', 'prompt', 'setTimeout', 'setInterval',
  'JSON', 'Math', 'Date', 'Object', 'Array', 'Number', 'String', 'Promise', 'eval', 'Function',
]);

let cspParser;
async function loadCspParser() {
  if (cspParser) return cspParser;
  // @alpinejs/csp ships its parser as an ES module without "type": "module"; copy it so Node
  // can import the real thing instead of a hand-written approximation.
  const src = require.resolve('@alpinejs/csp/src/parser.js', { paths: [__dirname, process.cwd()] });
  const cacheDir = path.join(require('os').tmpdir(), 'primo-alpine');
  fs.mkdirSync(cacheDir, { recursive: true });
  const target = path.join(cacheDir, 'alpine-csp-parser.mjs');
  fs.writeFileSync(target, fs.readFileSync(src, 'utf8'));
  // The parser snapshots globalThis on load, which trips Node deprecation getters.
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    cspParser = await import(require('url').pathToFileURL(target).href);
  } finally {
    process.emitWarning = emit;
  }
  return cspParser;
}

function expressionOf(attrName, value) {
  if (NON_EXPRESSION.test(attrName)) return null;
  const isDirective = attrName.startsWith('x-') || attrName.startsWith(':') || attrName.startsWith('@');
  if (!isDirective) return null;
  if (attrName === 'x-for') {
    const m = /^\s*(?:\(?[\w\s,]+\)?)\s+(?:in|of)\s+([\s\S]+)$/.exec(value);
    return m ? m[1] : value;
  }
  if (attrName === 'x-data' && value.trim() === '') return null;
  return value;
}

function checkExpression(parser, attrName, expression) {
  if (attrName === 'x-html') return ['x-html is prohibited in the CSP build'];
  const problems = [];
  let tokens;
  try {
    tokens = new parser.Tokenizer(expression).tokenize();
    new parser.Parser(tokens).parse();
  } catch (err) {
    problems.push(err.message);
    return problems;
  }
  tokens.forEach((token, i) => {
    if (token.type !== 'IDENTIFIER' || !PROHIBITED_GLOBALS.has(token.value)) return;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (prev && prev.value === '.') return; // property access, e.g. item.location
    if (next && next.value === ':' && prev && (prev.value === '{' || prev.value === ',')) return; // object key
    problems.push(`global "${token.value}" is not accessible in the CSP build`);
  });
  return problems;
}

function walk(node, visit) {
  if (node.attrs) visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
  if (node.content) walk(node.content, visit); // <template>
}

/** Lints one island's template. Returns [{ line, col, attr, expression, message }]. */
async function lintIsland(island) {
  const parser = await loadCspParser();
  const { parseFragment } = require('parse5');
  const html = fs.readFileSync(island.templatePath, 'utf8');
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const issues = [];
  walk(fragment, (el) => {
    for (const attr of el.attrs) {
      const expression = expressionOf(attr.name, attr.value);
      if (expression === null) continue;
      const loc = el.sourceCodeLocation?.attrs?.[attr.name] ?? el.sourceCodeLocation ?? {};
      for (const message of checkExpression(parser, attr.name, expression)) {
        issues.push({ line: loc.startLine ?? 0, col: loc.startCol ?? 0, attr: attr.name, expression, message });
      }
    }
  });
  return issues;
}

/**
 * Reports, per island and per line, what would break under a strict CSP. Never rewrites code.
 * Returns the number of issues in islands marked cspSafe (those fail CI).
 */
async function lintAll({ root } = {}) {
  const { islands, errors } = generateAll({ quiet: true, root });
  let blocking = errors.length;
  for (const island of islands) {
    const issues = await lintIsland(island);
    const mode = island.cspSafe ? 'cspSafe' : 'report';
    if (!issues.length) {
      console.log(`✓ ${island.rel} (${mode}): CSP-safe`);
      continue;
    }
    const mark = island.cspSafe ? '✗' : '!';
    console.log(`${mark} ${island.rel} (${mode}): ${issues.length} expression(s) would break under a strict CSP`);
    for (const i of issues) {
      console.log(`    template.html:${i.line}:${i.col}  ${i.attr}="${i.expression.trim()}"\n      → ${i.message}`);
    }
    if (island.cspSafe) blocking += issues.length;
  }
  if (!islands.length) console.log('No islands found.');
  return blocking;
}

module.exports = { lintIsland, lintAll, checkExpression, expressionOf };
