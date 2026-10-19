// primo-shared-state is compiled with tsc decorators; its DI metadata needs the polyfill.
import 'reflect-metadata';
import { Component, ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PrimoAlpineContext, providePrimoAlpine } from './context';
import { getAlpine } from './alpine';
import { AlpineIsland } from './island';

const flush = () => new Promise((resolve) => setTimeout(resolve));

const doc = (id: string, title: string) => ({ '@id': id, pnx: { control: { recordid: [id] }, display: { title: [title] } } });

@Component({ selector: 'test-island', standalone: true, template: '' })
class TestIsland extends AlpineIsland {
  static override island = 'test-island';
  static override slot = 'nde-record-availability';
  static override html = `
    <p x-data>
      <span class="total" x-text="$primo.search.totalResults"></span>
      <span class="title" x-text="$record ? $record.pnx.display.title[0] : 'none'"></span>
      <span class="label" x-text="$t('hello')"></span>
      <img x-asset-src="assets/images/logo.png">
      <button type="button" @click="$primo.search.totalResults = 1">write</button>
    </p>`;
}

describe('AlpineIsland', () => {
  let store: MockStore;
  const state = (total: number, entities: Record<string, unknown>) => ({
    Search: { searchResultsMetaData: { info: { total } }, entities },
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestIsland, TranslateModule.forRoot()],
      providers: [
        provideMockStore({ initialState: state(5, { 'rec-1': doc('rec-1', 'From the store') }) }),
        providePrimoAlpine({ assetBase: () => 'https://cdn.example/remote' }),
      ],
    });
    store = TestBed.inject(MockStore);
  });

  function mount(hostComponent: unknown): ComponentFixture<TestIsland> {
    const fixture = TestBed.createComponent(TestIsland);
    (fixture.componentRef as ComponentRef<TestIsland>).setInput('hostComponent', hostComponent);
    fixture.detectChanges();
    return fixture;
  }

  const text = (f: ComponentFixture<unknown>, sel: string) => (f.nativeElement as HTMLElement).querySelector(sel)!.textContent;

  it('renders host state and updates after a new search', async () => {
    const f = mount({ searchResult: doc('rec-1', 'host copy') });
    await flush();
    expect(text(f, '.total')).toBe('5');
    expect((f.nativeElement as HTMLElement).getAttribute('data-island')).toBe('test-island');

    store.setState(state(12, {}));
    await flush();
    expect(text(f, '.total')).toBe('12');
  });

  it('gives each record-level instance its own $record, store first, host doc as fallback', async () => {
    const a = mount({ searchResult: doc('rec-1', 'host copy') });
    const b = mount({ searchResult: doc('rec-2', 'Only on the host') });
    const c = mount({});
    await flush();
    expect(text(a, '.title')).toBe('From the store');
    expect(text(b, '.title')).toBe('Only on the host');
    expect(text(c, '.title')).toBe('none');

    // the host enriches rec-2 later
    store.setState(state(5, { 'rec-2': doc('rec-2', 'Enriched') }));
    await flush();
    expect(text(b, '.title')).toBe('Enriched');
  });

  it('follows the host component when it switches records', async () => {
    const f = mount({ searchResult: doc('rec-1', 'host copy') });
    await flush();
    f.componentRef.setInput('hostComponent', { searchResult: doc('rec-9', 'Switched') });
    await flush();
    expect(text(f, '.title')).toBe('Switched');
  });

  it('translates with $t and re-renders on language change', async () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { hello: 'Hello' });
    translate.setTranslation('nl', { hello: 'Hallo' });
    translate.use('en');
    const f = mount({});
    await flush();
    expect(text(f, '.label')).toBe('Hello');
    translate.use('nl');
    await flush();
    expect(text(f, '.label')).toBe('Hallo');
  });

  it('resolves x-asset-src against the remote public path', async () => {
    const f = mount({});
    await flush();
    expect((f.nativeElement as HTMLElement).querySelector('img')!.getAttribute('src')).toBe(
      'https://cdn.example/remote/assets/images/logo.png',
    );
  });

  it('keeps host state read-only from templates', async () => {
    const errors: Error[] = [];
    // Alpine's default handler rethrows asynchronously; capture instead.
    getAlpine().setErrorHandler((error: Error) => errors.push(error));
    try {
      const f = mount({});
      await flush();
      (f.nativeElement as HTMLElement).querySelector('button')!.click();
      await flush();
      await flush();
      expect(text(f, '.total')).toBe('5');
      expect(errors.length).toBe(1);
      expect(errors[0].message).toMatch(/read-only/);
    } finally {
      getAlpine().setErrorHandler((error: Error, el: Element, expression?: string) =>
        console.warn(`Alpine Expression Error: ${error.message}\n\nExpression: "${expression}"`, el),
      );
    }
  });

  it('detaches on destroy and releases subscriptions with the last island', async () => {
    const context = TestBed.inject(PrimoAlpineContext);
    const a = mount({ searchResult: doc('rec-1', 'x') });
    const b = mount({ searchResult: doc('rec-2', 'y') });
    await flush();
    expect(context.bridge.attachedIslands).toBe(2);
    expect(context.bridge.activeKeys).toContain('search.totalResults');

    a.destroy();
    expect(context.bridge.attachedIslands).toBe(1);
    expect(context.bridge.activeKeys).toContain('search.totalResults');

    // a's Alpine effects are gone: it no longer follows the store
    store.setState(state(99, {}));
    await flush();
    expect(text(a, '.total')).toBe('5');
    expect(text(b, '.total')).toBe('99');

    b.destroy();
    expect(context.bridge.attachedIslands).toBe(0);
    expect(context.bridge.activeKeys).toEqual([]);
  });
});