import { getAlpine } from './alpine';
import { BehaviorSubject, Observable, Subject, finalize } from 'rxjs';
import { PrimoBridge, PrimoStateLike, selectorKeys } from './bridge';

const Alpine = getAlpine();

/** Fake PrimoStateService built on Subjects, counting live subscriptions. */
class FakeSearch {
  total = new BehaviorSubject(0);
  term = new BehaviorSubject<string | undefined>(undefined);
  subscribed = 0;

  private track<T>(source: Observable<T>): Observable<T> {
    return new Observable<T>((sub) => {
      this.subscribed++;
      return source.pipe(finalize(() => this.subscribed--)).subscribe(sub);
    });
  }
  selectTotalResults$() {
    return this.track(this.total);
  }
  selectCurrentSearchTerm$() {
    return this.track(this.term);
  }
  selectDocById$(_id: string) {
    return new Subject();
  }
  dispatch() {}
}

function setup(dev = false) {
  const search = new FakeSearch();
  const primo = { search, filters: {}, user: {}, config: {}, entity: {}, account: {} } as unknown as PrimoStateLike;
  const bridge = new PrimoBridge(primo, { reactive: Alpine.reactive, dev });
  return { search, bridge, view: bridge.view as any };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

/** Runs `read` in an Alpine effect and returns every value it saw. */
function track<T>(read: () => T): { values: T[]; stop(): void } {
  const values: T[] = [];
  const runner = Alpine.effect(() => {
    values.push(read());
  });
  return { values, stop: () => Alpine.release(runner) };
}

describe('PrimoBridge', () => {
  it('maps $primo.<domain>.<name> to select<Name>$()', () => {
    const { search, view } = setup();
    search.total.next(42);
    expect(view.search.totalResults).toBe(42);
  });

  it('subscribes lazily, only to keys that are read', () => {
    const { search, bridge, view } = setup();
    expect(search.subscribed).toBe(0);
    void view.search.totalResults;
    expect(search.subscribed).toBe(1);
    expect(bridge.activeKeys).toEqual(['search.totalResults']);
    void view.search.totalResults;
    expect(search.subscribed).toBe(1);
  });

  it('re-runs Alpine effects on emissions via tick counters', async () => {
    const { search, view } = setup();
    const t = track(() => view.search.totalResults);
    expect(t.values).toEqual([0]);
    search.total.next(7);
    await flush(); // Alpine schedules effects in a microtask
    expect(t.values).toEqual([0, 7]);
    t.stop();
  });

  it('only re-runs effects that read the key that changed', async () => {
    const { search, view } = setup();
    const total = track(() => view.search.totalResults);
    const term = track(() => view.search.currentSearchTerm);
    search.term.next('alpine');
    await flush();
    expect(total.values.length).toBe(1);
    expect(term.values).toEqual([undefined, 'alpine']);
    total.stop();
    term.stop();
  });

  it('keeps values raw (never wrapped in a reactive proxy)', () => {
    const { search, view } = setup();
    const doc = { a: { b: 1 } };
    (search.total as any).next(doc);
    expect(view.search.totalResults).toBe(doc);
  });

  it('releases every subscription when the last island detaches', () => {
    const { search, bridge, view } = setup();
    bridge.attach();
    bridge.attach();
    void view.search.totalResults;
    void view.search.currentSearchTerm;
    expect(search.subscribed).toBe(2);
    bridge.detach();
    expect(search.subscribed).toBe(2);
    bridge.detach();
    expect(search.subscribed).toBe(0);
    expect(bridge.activeKeys).toEqual([]);

    // and resubscribes on the next read
    bridge.attach();
    search.total.next(3);
    expect(view.search.totalResults).toBe(3);
    expect(search.subscribed).toBe(1);
  });

  it('is read-only: assignments and deletes throw', () => {
    const { view } = setup();
    expect(() => (view.search.totalResults = 1)).toThrowError(TypeError, /read-only/);
    expect(() => delete view.search.totalResults).toThrowError(TypeError);
    expect(() => (view.search = {})).toThrowError(TypeError);
    expect(() => Object.defineProperty(view.search, 'x', { value: 1 })).toThrowError(TypeError);
  });

  it('is never wrapped by Alpine reactivity', () => {
    const { view } = setup();
    const data = Alpine.reactive({ p: view.search });
    expect(data.p).toBe(view.search);
  });

  it('returns undefined for unknown and parametrised keys, warning once in dev mode', () => {
    const { view } = setup(true);
    const warn = spyOn(console, 'warn');
    expect(view.search.nope).toBeUndefined();
    expect(view.search.nope).toBeUndefined();
    expect(view.search.docById).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('deep-freezes emitted values in dev mode', () => {
    const { search, view } = setup(true);
    (search.total as any).next({ info: { total: 1 }, list: [{ x: 1 }] });
    const value = view.search.totalResults;
    expect(Object.isFrozen(value)).toBeTrue();
    expect(Object.isFrozen(value.info)).toBeTrue();
    expect(Object.isFrozen(value.list[0])).toBeTrue();
  });

  it('lists keys for zero-argument selectors only', () => {
    expect(selectorKeys(new FakeSearch())).toEqual(['currentSearchTerm', 'totalResults']);
    const { view } = setup();
    expect(Object.keys(view.search)).toEqual(['currentSearchTerm', 'totalResults']);
    expect(Object.keys(view)).toEqual(['search', 'filters', 'user', 'config', 'entity', 'account']);
  });
});
