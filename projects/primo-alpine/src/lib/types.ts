import type { Observable } from 'rxjs';
import type { Doc, PrimoStateService } from '@libis/primo-shared-state';

/** The state domains `$primo` exposes. Mirrors the `PrimoStateService` facade. */
export const PRIMO_DOMAINS = ['search', 'filters', 'user', 'config', 'entity', 'account'] as const;
export type PrimoDomain = (typeof PRIMO_DOMAINS)[number];

/**
 * Turns a state service into its read-only `$primo` view:
 * every zero-argument `selectFoo$(): Observable<T>` becomes `readonly foo: T`.
 * Parametrised selectors (`selectDocById$(id)`) are left out on purpose.
 */
export type DomainView<S> = {
  readonly [M in keyof S as M extends `select${infer N}$`
    ? S[M] extends () => Observable<unknown>
      ? Uncapitalize<N>
      : never
    : never]: S[M] extends () => Observable<infer T> ? T : never;
};

/** The shape of `$primo` in island templates and `logic.js`. Derived at type level, no codegen. */
export type PrimoView = {
  readonly [D in PrimoDomain]: DomainView<PrimoStateService[D]>;
};

/** The magics every island can use. Handy as `@this` in `logic.js` JSDoc. */
export interface IslandMagics {
  readonly $primo: PrimoView;
  /** The current record in record-level slots, `undefined` elsewhere. */
  readonly $record: Doc | undefined;
  /** The raw host component instance. Never reactive. */
  readonly $hostComponent: any;
  /** Translate a key; re-evaluates when the language or translations change. */
  $t(key: string, params?: Record<string, unknown>): string;
  /** Resolve an `assets/...` path against this remote's public path. */
  $asset(path: string): string;
  readonly $el: HTMLElement;
  readonly $root: HTMLElement;
  readonly $refs: Record<string, HTMLElement>;
  $dispatch(event: string, detail?: unknown): void;
  $nextTick(callback?: () => void): Promise<void>;
  $watch<T>(property: string, callback: (value: T, oldValue: T) => void): void;
}

/**
 * Type for component objects registered with `Alpine.data` in `logic.js`:
 *
 * ```js
 * /** @type {import('@libis/primo-alpine').IslandData<{ open: boolean }>} *\/
 * const summary = { open: false, get total() { return this.$primo.search.totalResults; } };
 * ```
 */
export type IslandData<T extends object> = T & ThisType<T & IslandMagics> & { init?(): void; destroy?(): void };
