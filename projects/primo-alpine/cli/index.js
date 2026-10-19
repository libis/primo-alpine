// Programmatic API of the primo-alpine tooling: require('@libis/primo-alpine/cli').
'use strict';

const islands = require('./islands');

module.exports = {
  loadConfig: require('./config').loadConfig,
  generateAll: islands.generateAll,
  watch: islands.watch,
  scaffoldIsland: islands.scaffoldIsland,
  findIslands: islands.findIslands,
  slotKey: islands.slotKey,
  PrimoAlpineWebpackPlugin: islands.PrimoAlpineWebpackPlugin,
  lintAll: (...args) => require('./lint').lintAll(...args),
  importTokens: (...args) => require('./tokens').importTokens(...args),
  init: (...args) => require('./init').init(...args),
};
