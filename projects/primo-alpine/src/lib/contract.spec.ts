// primo-shared-state is compiled with tsc decorators; its DI metadata needs the polyfill.
import 'reflect-metadata';
import { TestBed } from '@angular/core/testing';
import { PrimoStateService } from '@libis/primo-shared-state';
import { provideMockStore } from '@ngrx/store/testing';
import { isObservable } from 'rxjs';
import { selectorKeys } from './bridge';
import { PRIMO_DOMAINS } from './types';

/**
 * Contract with @libis/primo-shared-state, which is regenerated from the host. If a regeneration
 * breaks the `select<Name>$()` convention or drops keys islands rely on, this fails in CI.
 */
describe('primo-shared-state contract', () => {
  let primo: PrimoStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideMockStore({ initialState: {} })] });
    primo = TestBed.inject(PrimoStateService);
  });

  it('exposes every domain $primo maps', () => {
    for (const domain of PRIMO_DOMAINS) {
      expect(primo[domain]).withContext(domain).toBeDefined();
      expect(selectorKeys(primo[domain]).length).withContext(`${domain} has no select*$() methods`).toBeGreaterThan(0);
    }
  });

  it('returns an Observable from every zero-argument select*$()', () => {
    for (const domain of PRIMO_DOMAINS) {
      const service = primo[domain] as any;
      for (const key of selectorKeys(service)) {
        const name = `select${key[0].toUpperCase()}${key.slice(1)}$`;
        expect(isObservable(service[name]())).withContext(`${domain}.${name}`).toBeTrue();
      }
    }
  });

  it('keeps the keys islands and $record depend on', () => {
    const required: Record<string, string[]> = {
      search: ['allDocs', 'totalResults', 'isLoading', 'currentSearchTerm', 'searchParams', 'searchStatus'],
      user: ['jwt'],
      config: [],
    };
    for (const [domain, keys] of Object.entries(required)) {
      const available = selectorKeys((primo as any)[domain]);
      for (const key of keys) expect(available).withContext(domain).toContain(key);
    }
    expect(typeof primo.search.selectDocById$).toBe('function');
  });
});