import { AfterViewInit, Directive, ElementRef, EffectRef, Injector, Input, OnDestroy, effect, inject } from '@angular/core';
import { AlpineType, getAlpine, runSetupOnce } from './alpine';
import { PrimoAlpineContext } from './context';
import { setIslandState } from './island-state';
import { RecordTracker } from './record';

/**
 * Base class for an Alpine island: an Angular component with an empty template whose markup
 * (`static html`) is injected after view init and handed to Alpine.
 *
 * ```ts
 * @Component({ selector: 'custom-island-summary', template: '', encapsulation: ViewEncapsulation.None })
 * export class SummaryIsland extends AlpineIsland {
 *   static override html = `<p x-data x-text="$primo.search.totalResults"></p>`;
 * }
 * ```
 */
@Directive()
export abstract class AlpineIsland implements AfterViewInit, OnDestroy {
  /** Alpine markup for this island. */
  static html = '';
  /**
   * Island name, set as `data-island` on the root element. The host decides the custom element's
   * tag name, so island styles are scoped with `[data-island="<name>"]` rather than a tag selector.
   */
  static island?: string;
  /** The host slot this island is attached to (e.g. `nde-record-availability`); enables `$record`. */
  static slot?: string;
  /** Optional one-time registration (`Alpine.data`, `Alpine.store`), usually the default export of `logic.js`. */
  static setup?: (Alpine: AlpineType) => void;

  private readonly root: HTMLElement = inject(ElementRef).nativeElement;
  private readonly context = inject(PrimoAlpineContext);
  private readonly injector = inject(Injector);
  private readonly record = new RecordTracker(this.context, (this.constructor as typeof AlpineIsland).slot);
  private recordEffect?: EffectRef;
  private host: unknown;
  private mounted = false;

  /** Set by the NDE host. Exposed raw as `$hostComponent`. */
  @Input()
  set hostComponent(value: unknown) {
    this.host = value;
    if (this.mounted) this.record.update(value);
  }
  get hostComponent(): unknown {
    return this.host;
  }

  ngAfterViewInit(): void {
    const island = this.constructor as typeof AlpineIsland;
    const Alpine = getAlpine();
    runSetupOnce(island.setup);

    const self = this;
    setIslandState(this.root, {
      context: this.context,
      record: this.record,
      get hostComponent() {
        return self.host;
      },
    });
    this.context.bridge.attach();
    this.mounted = true;

    if (this.record.supported) {
      this.record.update(this.host);
      // If the host keeps its record in a signal input, a reused host instance switching
      // records re-runs this effect and $record follows.
      this.recordEffect = effect(() => this.record.update(this.host), { injector: this.injector });
    }

    if (island.island) this.root.setAttribute('data-island', island.island);
    this.root.innerHTML = island.html;
    this.context.zone.runOutsideAngular(() => Alpine.initTree(this.root));
  }

  ngOnDestroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    getAlpine().destroyTree(this.root);
    this.recordEffect?.destroy();
    this.record.stop();
    this.context.bridge.detach();
    setIslandState(this.root, undefined);
  }
}
