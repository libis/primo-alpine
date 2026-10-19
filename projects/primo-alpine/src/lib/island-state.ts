import type { PrimoAlpineContext } from './context';
import type { RecordTracker } from './record';

/** What the magics need to know about the island an expression runs in. */
export interface IslandState {
  readonly context: PrimoAlpineContext;
  readonly hostComponent: unknown;
  readonly record: RecordTracker;
}

const ISLAND = Symbol.for('@libis/primo-alpine:island');

export function setIslandState(root: Element, state: IslandState | undefined): void {
  (root as any)[ISLAND] = state;
}

/** Finds the state of the closest island around `el` (islands can nest). */
export function islandStateFor(el: Element | null): IslandState | undefined {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const state = (node as any)[ISLAND] as IslandState | undefined;
    if (state) return state;
  }
  return undefined;
}
