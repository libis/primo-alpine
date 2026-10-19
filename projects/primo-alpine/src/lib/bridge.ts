import type { Observable, Subscription } from 'rxjs';
import { deepFreeze, warn } from './dev';
import { PRIMO_DOMAINS, PrimoDomain, PrimoView } from './types';

/** The part of `PrimoStateService` the bridge needs: one object per domain. */
export type PrimoStateLike = { readonly [D in PrimoDomain]: object };

export interface BridgeOptions {
  /** Alpine's `reactive` (or any compatible reactivity function). Used only for tick counters. */
  reactive: <T extends object>(target: T) => T;
  /** Dev mode: deep-freeze emitted values and warn about unknown keys. */
  dev?: boolean;
  /** Wraps subscribe calls, e.g. `NgZone.runOutsideAngular`. */
  runOutside?: <T>(fn: () => T) => T;
}

interface Entry {
  value: unknown;
  subscription?: Subscription;
}

/**
 * Keys Alpine, Vue reactivity, promises or devtools may probe on any object.
 * They are answered without a warning and never subscribe.
 */
const PROBE_KEYS = new Set(['then', 'toJSON', 'constructor', '$$typeof', 'nodeType', 'asymmetricMatch']);

export function selectorName(key: string): string {
  return `select${key.charAt(0).toUpperCase()}${key.slice(1)}$`;
}

/** Lists the `$primo` keys a state service offers: every zero-argument `selectFoo$()` method. */
export function selectorKeys(service: object): string[] {
  const keys = new Set<string>();
  for (let proto = service; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const match = /^select(.+)\$$/.exec(name);
      const member = (service as any)[name];
      if (match && typeof member === 'function' && member.length === 0) {
        keys.add(match[1].charAt(0).toLowerCase() + match[1].slice(1));
      }
    }
  }
  return [...keys].sort();
}

/**
 * Connects `PrimoStateService` observables to Alpine's reactivity.
 *
 * - `$primo.<domain>.<name>` maps to `primo.<domain>.select<Name>$()`.
 * - Subscriptions are lazy (made on first read) and all released when the last island detaches.
 * - Values are kept raw; Alpine tracks a per-key tick counter instead of the value itself.
 * - The view is read-only: assignments and deletes throw.
 */
export class PrimoBridge {
  readonly view: PrimoView;

  private readonly entries = new Map<string, Entry>();
  private readonly ticks: Record<string, number>;
  private readonly warned = new Set<string>();
  private readonly domainViews = new Map<string, object>();
  private islands = 0;

  constructor(
    private readonly primo: PrimoStateLike,
    private readonly options: BridgeOptions,
  ) {
    this.ticks = options.reactive({} as Record<string, number>);
    this.view = this.createRootView();
  }

  /** Called by each island when it mounts. */
  attach(): void {
    this.islands++;
  }

  /** Called by each island when it is destroyed. The last one out releases every subscription. */
  detach(): void {
    this.islands = Math.max(0, this.islands - 1);
    if (this.islands === 0) this.releaseAll();
  }

  /** Keys that currently hold a live subscription (for tests and debugging). */
  get activeKeys(): string[] {
    return [...this.entries.entries()].filter(([, e]) => e.subscription && !e.subscription.closed).map(([k]) => k);
  }

  get attachedIslands(): number {
    return this.islands;
  }

  /** Reads one key, subscribing on first use. Tracked by the calling Alpine effect. */
  read(domain: PrimoDomain, key: string): unknown {
    const id = `${domain}.${key}`;
    let entry = this.entries.get(id);
    if (!entry) {
      const selector = this.selector(domain, key);
      if (!selector) {
        if (this.options.dev && !this.warned.has(id)) {
          this.warned.add(id);
          warn(`Unknown key $primo.${id}: ${domain} has no ${selectorName(key)}().`, selectorKeys(this.domain(domain)));
        }
        return undefined;
      }
      entry = this.subscribe(id, selector);
    }
    void this.ticks[id]; // register the dependency
    return entry.value;
  }

  private subscribe(id: string, selector: () => Observable<unknown>): Entry {
    const entry: Entry = { value: undefined };
    this.entries.set(id, entry);
    this.ticks[id] = 0;

    // NgRx selects emit synchronously on subscribe. That first value is stored without
    // bumping the tick, because we are usually inside the very effect that is reading it.
    let subscribing = true;
    const run = this.options.runOutside ?? ((fn) => fn());
    entry.subscription = run(() =>
      selector().subscribe({
        next: (value) => {
          entry.value = this.options.dev ? deepFreeze(value) : value;
          if (!subscribing) this.ticks[id]++;
        },
        error: (err) => warn(`$primo.${id} errored; keeping the last value.`, err),
      }),
    );
    subscribing = false;
    return entry;
  }

  private releaseAll(): void {
    for (const entry of this.entries.values()) entry.subscription?.unsubscribe();
    this.entries.clear();
  }

  private domain(domain: PrimoDomain): object {
    return (this.primo as any)[domain];
  }

  private selector(domain: PrimoDomain, key: string): (() => Observable<unknown>) | undefined {
    const service = this.domain(domain) as any;
    const fn = service?.[selectorName(key)];
    if (typeof fn !== 'function' || fn.length !== 0) return undefined;
    return () => fn.call(service);
  }

  private createRootView(): PrimoView {
    return readOnlyProxy('$primo', {
      get: (prop) => ((PRIMO_DOMAINS as readonly string[]).includes(prop) ? this.domainView(prop as PrimoDomain) : undefined),
      keys: () => [...PRIMO_DOMAINS],
    }) as PrimoView;
  }

  private domainView(domain: PrimoDomain): object {
    let view = this.domainViews.get(domain);
    if (!view) {
      view = readOnlyProxy(`$primo.${domain}`, {
        get: (prop) => this.read(domain, prop),
        keys: () => selectorKeys(this.domain(domain)),
      });
      this.domainViews.set(domain, view);
    }
    return view;
  }
}

function readOnlyProxy(label: string, source: { get(prop: string): unknown; keys(): string[] }): object {
  const reject = (prop: PropertyKey): never => {
    throw new TypeError(`${label}.${String(prop)} is read-only. Host state cannot be changed from an island.`);
  };
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      // Tell Vue reactivity (used by Alpine) never to wrap this proxy.
      if (prop === '__v_skip') return true;
      if (typeof prop !== 'string' || prop.startsWith('__v_') || PROBE_KEYS.has(prop)) return undefined;
      return source.get(prop);
    },
    has: (_target, prop) => typeof prop === 'string' && source.keys().includes(prop),
    ownKeys: () => source.keys(),
    getOwnPropertyDescriptor: (_target, prop) =>
      typeof prop === 'string' && source.keys().includes(prop)
        ? { configurable: true, enumerable: true, get: () => source.get(prop) }
        : undefined,
    set: (_target, prop) => reject(prop),
    deleteProperty: (_target, prop) => reject(prop),
    defineProperty: (_target, prop) => reject(prop),
    setPrototypeOf: () => reject('__proto__'),
  });
}
