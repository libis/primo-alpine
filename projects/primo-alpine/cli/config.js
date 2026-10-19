// Reads the "primoAlpine" section of the project's package.json.
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @typedef {object} PrimoAlpineConfig
 * @property {string} islandsDir      Root scanned for island directories (containing island.json).
 * @property {'map'|'nde-decorator'} registration
 *   map:           one generated file exporting `islandMappings` for customComponentMappings.ts (vanilla customModule).
 *   nde-decorator: one `<name>.island.component.ts` per island, decorated with @NDEComponent (LIBIS fork).
 * @property {string} mapFile         Generated file in "map" mode.
 * @property {string} decoratorImport Module exporting NDEComponent, in "nde-decorator" mode.
 * @property {string[]} cspSafeDirs   Top-level directories (under islandsDir) whose islands default to cspSafe: true.
 * @property {string} tokensDir       Output of `tokens import`.
 */

const DEFAULTS = {
  islandsDir: 'src/app/islands',
  registration: 'map',
  mapFile: 'src/app/islands/islands.generated.ts',
  decoratorImport: 'src/app/decorators/nde-component.decorator',
  cspSafeDirs: [],
  tokensDir: 'src/app/styles/tokens',
};

function findProjectRoot(start = process.cwd()) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'angular.json'))) return dir;
    if (path.dirname(dir) === dir) return path.resolve(start);
  }
}

/** @returns {{ root: string, config: PrimoAlpineConfig, abs: (p: string) => string }} */
function loadConfig(root = findProjectRoot()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = { ...DEFAULTS, ...(pkg.primoAlpine || {}) };
  if (!['map', 'nde-decorator'].includes(config.registration)) {
    throw new Error(`primoAlpine.registration must be "map" or "nde-decorator", got "${config.registration}"`);
  }
  return { root, config, abs: (p) => path.resolve(root, p) };
}

module.exports = { DEFAULTS, loadConfig, findProjectRoot };
