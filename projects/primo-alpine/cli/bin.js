#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');

const HELP = `primo-alpine <command>

  init [--registration map|nde-decorator]   Wire islands into this customModule (safe to re-run)
  generate <name> --slot <nde-slot> [--position before|after|top|bottom|replace] [--dir <subdir>] [--csp-safe]
                                             Scaffold an island
  codegen [--watch]                          Generate the island components
  dev -- <command...>                        codegen, then watch while running <command> (e.g. npm run start:proxy)
  lint                                       Report expressions that would break under a strict CSP
  tokens import <snapshot.json> --env <name> Turn a token inspector export into committed files

Configuration: the "primoAlpine" section of package.json.`;

function option(args, flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

function fail(err) {
  console.error(`✗ ${err.message || err}`);
  process.exit(1);
}

async function main(argv) {
  const [command, ...args] = argv;
  switch (command) {
    case 'init':
      require('./init').init({ registration: option(args, '--registration', 'map') });
      return;

    case 'generate': {
      if (!args[0] || args[0].startsWith('--')) throw new Error('usage: primo-alpine generate <name> --slot <nde-slot> [--position ...]');
      require('./islands').scaffoldIsland(args[0], {
        slot: option(args, '--slot', 'nde-search-bar'),
        position: option(args, '--position', 'after'),
        dir: option(args, '--dir', ''),
        cspSafe: args.includes('--csp-safe') ? true : undefined,
      });
      return;
    }

    case 'codegen': {
      const islands = require('./islands');
      const { errors } = islands.generateAll();
      if (args.includes('--watch')) {
        islands.watch();
        return new Promise(() => {}); // until Ctrl+C
      }
      if (errors.length) process.exit(1);
      return;
    }

    case 'dev': {
      const sep = args.indexOf('--');
      const cmd = sep >= 0 ? args.slice(sep + 1) : args;
      if (!cmd.length) throw new Error('usage: primo-alpine dev -- <command...>');
      const islands = require('./islands');
      islands.generateAll();
      const stop = islands.watch();
      const child = spawn(cmd.join(' '), { stdio: 'inherit', shell: true });
      const forward = (signal) => child.kill(signal);
      process.on('SIGINT', forward);
      process.on('SIGTERM', forward);
      child.on('exit', (code) => {
        stop();
        process.exit(code ?? 0);
      });
      return;
    }

    case 'lint': {
      const blocking = await require('./lint').lintAll();
      process.exit(blocking ? 1 : 0);
      return;
    }

    case 'tokens':
      if (args[0] !== 'import') throw new Error('usage: primo-alpine tokens import <snapshot.json> --env <name>');
      require('./tokens').importTokens(args[1], option(args, '--env'));
      return;

    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(HELP);
      return;

    default:
      throw new Error(`Unknown command "${command}"\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch(fail);
