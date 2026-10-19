import { isSignal } from '@angular/core';
import type { Doc } from '@libis/primo-shared-state';
import { Subscription, combineLatest, map } from 'rxjs';
import { getAlpine } from './alpine';
import type { PrimoAlpineContext } from './context';
import { warn } from './dev';

/** Returns the record a host component holds, or `undefined`. May read signals. */
export type RecordResolver = (hostComponent: any) => Doc | undefined;

/** Unwraps a signal input; plain fields pass through. */
const read = (value: unknown): any => (isSignal(value) ? value() : value);

/**
 * The single place that knows host component internals. Maps a slot (the host element name,
 * without position suffix) to where its component keeps the record. Only the record's identity
 * is taken from here; its data comes from the store (see {@link RecordTracker}).
 *
 * Verified against NDE (September 2026): on the results page records render in
 * `nde-search-result-item-container`; there is no `nde-brief-result` element. The host fields
 * are plain properties, not signal inputs, but `read` unwraps signals should that change.
 */
export const RECORD_RESOLVERS: Record<string, RecordResolver> = {
  'nde-record-availability': (h) => read(h?.searchResult),
  'nde-record-image': (h) => read(h?.item),
  // Not yet verified against the live host:
  'nde-full-display': (h) => read(h?.record) ?? read(h?.fullDisplayRecord) ?? read(h?.searchResult) ?? read(h?.item),
  'nde-brief-result': (h) => read(h?.searchResult) ?? read(h?.item),
};

/**
 * Keys the host store might use for this doc. NDE keys `Search.entities` by
 * `pnx.control.recordid[0]` (e.g. `alma99...`); `@id` (the PNX URL) is a fallback.
 */
export function recordKeys(doc: Doc | undefined): string[] {
  const keys = [doc?.pnx?.control?.recordid?.[0], doc?.['@id']];
  return [...new Set(keys.filter((k): k is string => typeof k === 'string' && k.length > 0))];
}

/**
 * `$record` for one island: identity from the host component, data from `primo.search`,
 * so it updates when the host enriches the record (delivery, availability, ...). When the store
 * has no such doc (a deep-linked full display), the host component's own doc is used as-is.
 */
export class RecordTracker {
  private value: Doc | undefined;
  private key = '';
  private subscription?: Subscription;
  private warned = false;
  private readonly tick = getAlpine().reactive({ n: 0 });

  constructor(
    private readonly context: PrimoAlpineContext,
    private readonly slot: string | undefined,
  ) {}

  /** Whether `$record` means anything in this island's slot. */
  get supported(): boolean {
    return !!this.slot && this.slot in RECORD_RESOLVERS;
  }

  /** Re-resolves the record from the host component. Cheap when the record did not change. */
  update(hostComponent: unknown): void {
    if (!this.supported) return;
    const hostDoc = RECORD_RESOLVERS[this.slot!](hostComponent);
    const keys = recordKeys(hostDoc);
    const key = keys.join('|');
    if (key === this.key) return;
    this.key = key;
    this.subscription?.unsubscribe();

    if (!keys.length) {
      if (this.context.dev && hostComponent && !this.warned) {
        this.warned = true;
        warn(`No record id found on the ${this.slot} host component; the resolver in RECORD_RESOLVERS may be outdated.`, hostComponent);
      }
      this.set(hostDoc);
      return;
    }

    const search = this.context.primo.search;
    this.subscription = this.context.zone.runOutsideAngular(() =>
      combineLatest(keys.map((k) => search.selectDocById$(k)))
        .pipe(map((docs) => docs.find(Boolean) ?? hostDoc))
        .subscribe((doc) => this.set(doc)),
    );
  }

  read(): Doc | undefined {
    void this.tick.n;
    return this.value;
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.key = '';
  }

  private set(doc: Doc | undefined): void {
    if (doc === this.value) return;
    this.value = doc;
    this.tick.n++;
  }
}
