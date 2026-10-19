# @libis/primo-alpine

Build Primo NDE customizations as plain HTML plus [Alpine.js](https://alpinejs.dev) "islands", without writing Angular. Islands react to host state (search results, filters, user, config) through [`@libis/primo-shared-state`](https://github.com/libis/primo-shared-state) and treat it as read-only.

The package contains the runtime and the `primo-alpine` command-line tool (islands, CSP lint, design tokens). It works in an unmodified Ex Libris [customModule](https://github.com/ExLibrisGroup/customModule) as well as in the LIBIS fork ([NDE_customModule](https://github.com/libis/NDE_customModule)).

## Versioning

The major version follows the host's Angular major: `19.x.y` is for Angular 19, `20.x.y` for Angular 20. Breaking changes within one Angular major are released as a minor version and called out in the changelog.

| primo-alpine | Angular | Tested against (ExLibrisGroup/customModule) |
|---|---|---|
| 19.x | 19.2 | `Angular-update` |
| 20.x | 20.3 | `November-2026-compatible` (not released yet) |

| Peer dependency | Range |
|---|---|
| `@angular/core` | `~19.2.0` (the remote tracks the host's Angular version) |
| `@libis/primo-shared-state` | `>=2026.6.1` (the `PrimoStateService` facade) |
| `@ngx-translate/core` | `>=15` |
| `alpinejs` | `~3.17.3` |
| `rxjs` | `^7` |

## Getting started in a customModule

In an Ex Libris customModule on the matching Angular version:

```bash
npm install @libis/primo-alpine @libis/primo-shared-state alpinejs@3.17.3
npx primo-alpine init
npx primo-alpine generate search-summary --slot nde-search-results --position top
npm run start:islands
```

`init` is safe to run again. It:

- adds a `"primoAlpine"` section to `package.json` (see [Configuration](#configuration));
- adds `primo-alpine codegen` before `build`, `start` and `start:proxy`, plus the scripts `start:islands`, `islands:watch` and `lint:islands`;
- adds `...islandMappings` to `selectorComponentMap` in `customComponentMappings.ts`;
- adds `...providePrimoAlpine({...})` to the providers in `app.module.ts`;
- gitignores the generated `src/app/islands/islands.generated.ts`.

When a file does not look like upstream's, `init` leaves it alone and prints the line to add.

An island is a directory under `src/app/islands/` with `island.json`, `template.html`, and optionally `logic.js` and `style.scss`. `npm run start:islands` runs `start:proxy` and regenerates the components whenever an island changes.

### Commands

| Command | What it does |
|---|---|
| `primo-alpine init [--registration map\|nde-decorator]` | Set up the project (see above) |
| `primo-alpine generate <name> --slot <nde-slot> [--position before\|after\|top\|bottom\|replace] [--dir <subdir>] [--csp-safe]` | Scaffold an island |
| `primo-alpine codegen [--watch]` | Generate the island components |
| `primo-alpine dev -- <command>` | `codegen`, then keep regenerating while `<command>` runs |
| `primo-alpine lint` | Report expressions that break under a strict CSP; fails only for islands with `cspSafe: true` |
| `primo-alpine tokens import <snapshot.json> --env <name>` | Turn a token inspector export into committed files |

The same functions are available from Node as `require('@libis/primo-alpine/cli')`, together with `PrimoAlpineWebpackPlugin` for projects that prefer regenerating inside webpack.

### `island.json`

```json
{
  "$schema": "../../../../node_modules/@libis/primo-alpine/island.schema.json",
  "selector": "nde-search-results",
  "position": "top",
  "priority": 100,
  "viewPattern": "^32KUL_",
  "cspSafe": true
}
```

`selector` and `position` give the slot key the host looks up (`nde-search-results-top`; `replace` uses the bare selector). `viewPattern` is a regular expression matched against the `vid`. When several islands claim one slot, the lowest `priority` wins; entries you add to `selectorComponentMap` after `...islandMappings` override islands.

### Configuration

The `"primoAlpine"` section of `package.json`:

| Key | Default | Meaning |
|---|---|---|
| `islandsDir` | `src/app/islands` | Where islands live (any depth) |
| `registration` | `map` | `map`: one generated file exporting `islandMappings`. `nde-decorator`: one `<name>.island.component.ts` per island with `@NDEComponent`, for the LIBIS fork |
| `mapFile` | `src/app/islands/islands.generated.ts` | Generated file in `map` mode |
| `decoratorImport` | `src/app/decorators/nde-component.decorator` | Module exporting `NDEComponent`, in `nde-decorator` mode |
| `cspSafeDirs` | `[]` | Top-level directories under `islandsDir` whose islands default to `cspSafe: true` (the fork uses `["central"]`) |
| `tokensDir` | `src/app/styles/tokens` | Output of `tokens import` |

### Runtime configuration

`init` adds this; in other setups, provide it once in the remote's root module:

```ts
import { providePrimoAlpine } from '@libis/primo-alpine';

providers: [
  ...providePrimoAlpine({
    dev: ['localhost', '127.0.0.1'].includes(location.hostname), // freeze host values, warn on unknown keys, ?ndeTokens=1
    assetBase: () => assetBaseUrl,                                // where `assets/...` resolves
  }),
];
```

## Islands

An island is an Angular component with an empty template that extends `AlpineIsland`:

```ts
@Component({ selector: 'custom-island-summary', standalone: true, template: '', encapsulation: ViewEncapsulation.None })
export class SummaryIsland extends AlpineIsland {
  static override island = 'summary';               // set as data-island="summary" on the root
  static override slot = 'nde-search-results';      // the host slot; enables $record where supported
  static override setup = (Alpine) => { /* Alpine.data(...) */ };  // optional, runs once per page
  static override html = `<p x-data x-text="$primo.search.totalResults"></p>`;
}
```

`primo-alpine codegen` generates these classes from `island.json` and `template.html`; you do not write them by hand.

On `ngAfterViewInit` the island injects `html` and calls `Alpine.initTree`. On `ngOnDestroy` it calls `Alpine.destroyTree` and releases its subscriptions. Everything runs outside the Angular zone.

## Magics and directives

| Name | Value |
|---|---|
| `$primo` | Read-only view of host state (see below) |
| `$record` | The current `Doc` in record-level slots, otherwise `undefined` |
| `$t(key, params?)` | `TranslateService.instant`, re-evaluated on language and translation changes |
| `$asset(path)` | `assets/...` resolved against `assetBase` |
| `x-asset-src="assets/..."` | Sets `src` (or `href` on `<a>` and `<link>`) from a literal path. Not evaluated, so CSP-safe |
| `$hostComponent` | The raw host component instance. Never reactive; prefer the above |

### `$primo` naming rules

`$primo.<domain>.<name>` reads `primo.<domain>.select<Name>$()` on `PrimoStateService`:

| Expression | Calls |
|---|---|
| `$primo.search.totalResults` | `primo.search.selectTotalResults$()` |
| `$primo.search.isLoading` | `primo.search.selectIsLoading$()` |
| `$primo.user.jwt` | `primo.user.selectJwt$()` |
| `$primo.filters.includedFilters` | `primo.filters.selectIncludedFilters$()` |

- Domains: `search`, `filters`, `user`, `config`, `entity`, `account`.
- Only zero-argument selectors are exposed. Parametrised ones such as `selectDocById$(id)` are not; use `$record` for the current record.
- Subscriptions are lazy: an island only subscribes to what its template reads. All subscriptions are released when the last island is destroyed.
- Values are not wrapped in Alpine proxies. Alpine tracks a per-key counter instead, so only expressions reading a key re-run when it changes.
- Assigning to or deleting from `$primo` throws a `TypeError`.
- With `dev: true`, emitted values are deep-frozen (accidental mutation throws) and unknown keys log a warning listing the valid ones.

The TypeScript type `PrimoView` is derived from `PrimoStateService`, so it follows `primo-shared-state` regenerations automatically. `IslandMagics` and `IslandData<T>` type `this` in `logic.js` through JSDoc:

```js
/** @param {import('@libis/primo-alpine').AlpineType} Alpine */
export default function setup(Alpine) {
  Alpine.data('summary', () =>
    /** @type {import('@libis/primo-alpine').IslandData<{ readonly label: string }>} */ ({
      get label() {
        return `${this.$primo.search.totalResults} results`;
      },
    }),
  );
}
```

### `$record`

The record's identity comes from the host component, its data from the store:

1. A per-slot resolver in `RECORD_RESOLVERS` takes the record from `hostComponent`. This is the only code that knows host component internals.
2. `$record` then follows `primo.search.selectDocById$(pnx.control.recordid[0])`, so it updates when the host enriches the record. NDE keys its store by `recordid`, not by `@id`.
3. When the store has no such record (a deep-linked full display), the host component's own copy is used.

Verified slots (NDE, September 2026): `nde-record-availability` (`hostComponent.searchResult`) and `nde-record-image` (`hostComponent.item`). On the results page records render in `nde-search-result-item-container`; there is no `nde-brief-result` element. `nde-full-display` has a best-guess resolver that still needs checking against the live host.

## Styling

Islands render into the host page without style encapsulation. Scope rules with `[data-island='<name>']`: the host decides the element's tag name (for example `nde-search-results-top-from-remote-0`), so a tag selector is not stable. Use the host's CSS custom properties, never host component classes, whose `_ngcontent` attributes change every build.

In NDE, colours are `--mat-sys-*` and the typescale is `--sys-*` (`--sys-body-medium`, `--sys-title-medium`, ...).

### Token inspector

With `dev: true`, add `?ndeTokens=1` to the page URL. The inspector lists every custom property defined on `:root`, `html`, `body` and theme classes, with colour swatches, type samples and click-to-copy `var(--...)`. **Export JSON** saves a snapshot; `primo-alpine tokens import` turns it into a committed snapshot (diff it after a Primo upgrade), SCSS variables, a Markdown table and a CSS file for the *CSS Variable Autocomplete* VS Code extension.

The inspector is a separate entry point (`@libis/primo-alpine/tokens`), loaded only when requested. `collectTokens()` returns the snapshot programmatically.

## How Alpine is loaded

- **One Alpine per page.** The first remote to load claims a page-wide singleton; later remotes (central package plus view package) reuse it, so magics and `Alpine.data` registrations are shared and never configured twice. A foreign `window.Alpine` triggers a warning.
- **`Alpine.start()` is never called.** It would observe mutations on the whole Primo document. Islands call `initTree` and `destroyTree` themselves. As a result, the `alpine:init` event never fires; register data in `setup` / `logic.js` instead.
- **Alpine gets a working evaluator.** When zone.js is used, Angular CLI (webpack and esbuild alike) downlevels `async` functions in every module, including Alpine. Alpine then gets plain `Function` where it expects `AsyncFunction`, and every expression fails with `func.call(...).catch is not a function`. At startup primo-alpine evaluates `1 + 1` through Alpine; only if that fails does it replace Alpine's evaluator with a port that takes the real `AsyncFunction` from a `new Function` string, which no bundler rewrites. It needs no build configuration. One difference remains: Alpine's internal `dontAutoEvaluateFunctions` (used only by `Alpine.extractProp`) is not honoured.
- **`reflect-metadata` is loaded first.** `@libis/primo-shared-state` is compiled with plain TypeScript decorators, and Angular reads its constructor parameters from `reflect-metadata`.

## Development

This repository is an Angular workspace; the library is in `projects/primo-alpine`.

```bash
npm install
npm test          # unit tests (Karma, headless Chrome)
npm run pack      # build + dist/libis-primo-alpine-<version>.tgz
npm run e2e       # the packed tgz in a fresh ExLibrisGroup/customModule (see below)
```

`@libis/primo-shared-state` is not on npm yet, so the workspace uses the copy in `vendor/`.

- The **unit tests** cover the bridge (laziness, ticks, reference counting, read-only enforcement, dev freezing), the island lifecycle with several record-level instances, the async-safe evaluator, and a contract test against the real `primo-shared-state` services, which fails when a regeneration breaks the `select<Name>$()` convention.
- The **e2e** (`scripts/e2e-vanilla.mjs`) clones ExLibrisGroup/customModule at `e2e.vanillaBranch` (the upstream branch on this major's Angular version), installs the tgz with strict peer dependencies, runs `init` twice, generates islands (including one with `logic.js` and one excluded by `viewPattern`), lints, builds, and checks the generated code and the bundle. `--branch <name>` tests another branch, `--keep` keeps the checkout.
- **CI** (`.github/workflows/ci.yml`) runs both on every push, and nightly against upstream. A `v<version>` tag publishes to npm with provenance after both pass (needs the `NPM_TOKEN` secret).

When you reinstall a tgz with an unchanged version number into a project, delete its `.angular/cache` first: webpack caches `node_modules` packages by version and will otherwise keep bundling the old build.

## License

MIT
