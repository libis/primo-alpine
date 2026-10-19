import BundledAlpine from 'alpinejs';
// Namespace import: the typings use `export =`, and a default import there would require
// allowSyntheticDefaultImports in every consumer's tsconfig (vanilla customModule has none).
import type * as AlpineTypings from 'alpinejs';
import { warn } from './dev';
import { alpineEvaluatorIsBroken, installAsyncSafeEvaluator } from './evaluator';
import { IslandState, islandStateFor } from './island-state';

/** Alpine's API. @types/alpinejs stops at 3.13, so 3.14+ additions used here are added. */
export type AlpineType = AlpineTypings.Alpine & {
  setErrorHandler(handler: (error: Error, el: Element, expression?: string) => void): void;
};

const SINGLETON = Symbol.for('@libis/primo-alpine');
const SUPPORTED = /^3\.17\./;

interface Singleton {
  Alpine: AlpineType;
  setups: WeakSet<object>;
}

/**
 * Returns the one Alpine instance islands use on this page, registering the primo magics once.
 *
 * Several remotes (central package plus a view package) can each bundle primo-alpine. The first
 * one to run claims the page; the others reuse its Alpine so magics, `Alpine.data` registrations
 * and stores are shared, and nothing is configured twice.
 *
 * `Alpine.start()` is never called: it would observe mutations on the whole Primo document.
 * Islands are initialised and destroyed explicitly with `initTree` / `destroyTree`.
 *
 * When Alpine's evaluator is broken because the bundler downleveled async/await (Angular with
 * zone.js), it is replaced by one that uses the real AsyncFunction; see evaluator.ts.
 */
export function getAlpine(): AlpineType {
  const g = globalThis as any;
  let singleton: Singleton | undefined = g[SINGLETON];
  if (!singleton) {
    const foreign: AlpineType | undefined = g.Alpine;
    if (foreign && foreign !== BundledAlpine) {
      warn(`Another Alpine (${foreign.version}) is already on the page (window.Alpine). Islands use their own bundled ${BundledAlpine.version}; avoid mixing them in one DOM tree.`);
    }
    if (!SUPPORTED.test(BundledAlpine.version)) {
      warn(`Alpine ${BundledAlpine.version} is outside the supported range ~3.17.`);
    }
    singleton = { Alpine: BundledAlpine as AlpineType, setups: new WeakSet() };
    // Only when Alpine's own evaluator fails (async downleveled); never for the CSP build.
    if (alpineEvaluatorIsBroken(singleton.Alpine)) installAsyncSafeEvaluator(singleton.Alpine);
    registerMagics(singleton.Alpine);
    Object.defineProperty(g, SINGLETON, { value: singleton });
  }
  return singleton.Alpine;
}

/** Runs an island's `logic.js` registration once per page, however many instances mount. */
export function runSetupOnce(setup: ((Alpine: AlpineType) => void) | undefined): void {
  if (!setup) return;
  const Alpine = getAlpine();
  const { setups } = (globalThis as any)[SINGLETON] as Singleton;
  if (setups.has(setup)) return;
  setups.add(setup);
  setup(Alpine);
}

function requireIsland(el: Element, name: string): IslandState | undefined {
  const state = islandStateFor(el);
  if (!state) warn(`${name} used outside an island.`, el);
  return state;
}

function registerMagics(Alpine: AlpineType): void {
  Alpine.magic('primo', (el) => requireIsland(el, '$primo')?.context.bridge.view);
  Alpine.magic('hostComponent', (el) => requireIsland(el, '$hostComponent')?.hostComponent);
  Alpine.magic('record', (el) => requireIsland(el, '$record')?.record.read());
  Alpine.magic('t', (el) => {
    const state = requireIsland(el, '$t');
    return (key: string, params?: Record<string, unknown>) => state?.context.translate(key, params) ?? key;
  });
  Alpine.magic('asset', (el) => {
    const state = requireIsland(el, '$asset');
    return (path: string) => state?.context.asset(path) ?? path;
  });

  // x-asset-src="assets/images/logo.png": the value is a literal path, never evaluated (CSP-safe).
  // Sets `href` on <a> and <link>, `src` on everything else.
  Alpine.directive('asset-src', (el, { expression }) => {
    const state = requireIsland(el, 'x-asset-src');
    const tag = el.tagName.toLowerCase();
    const attr = tag === 'a' || tag === 'link' ? 'href' : 'src';
    el.setAttribute(attr, state?.context.asset(expression) ?? expression);
  });
}
