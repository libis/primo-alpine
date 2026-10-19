import { Injectable, InjectionToken, NgZone, Provider, inject } from '@angular/core';
import { PrimoStateService } from '@libis/primo-shared-state';
import { TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';
import { getAlpine } from './alpine';
import { PrimoBridge } from './bridge';

export interface PrimoAlpineConfig {
  /** Dev mode: deep-freeze host values, warn about unknown `$primo` keys and missing records. */
  dev?: boolean;
  /**
   * Base URL for `assets/...` paths, read on every call. In a webpack remote pass
   * `() => __webpack_public_path__` so central and view packages each resolve their own assets.
   */
  assetBase?: () => string;
  /**
   * Mount the design-token inspector when the page URL has `?ndeTokens=1`. Only in dev mode, and
   * loaded lazily, so it never reaches production users. Default: true.
   */
  tokenInspector?: boolean;
}

export const PRIMO_ALPINE_CONFIG = new InjectionToken<PrimoAlpineConfig>('PRIMO_ALPINE_CONFIG');

export function providePrimoAlpine(config: PrimoAlpineConfig): Provider[] {
  return [{ provide: PRIMO_ALPINE_CONFIG, useValue: config }];
}

/**
 * Per-remote services the islands share: the `$primo` bridge, translation and asset resolution.
 * One instance per remote injector; the Alpine instance itself is shared page-wide.
 */
@Injectable({ providedIn: 'root' })
export class PrimoAlpineContext {
  readonly config: PrimoAlpineConfig = inject(PRIMO_ALPINE_CONFIG, { optional: true }) ?? {};
  readonly zone = inject(NgZone);
  readonly primo = inject(PrimoStateService);
  readonly bridge: PrimoBridge;

  private readonly translateService = inject(TranslateService, { optional: true });
  private readonly i18n = getAlpine().reactive({ tick: 0 });

  constructor() {
    this.bridge = new PrimoBridge(this.primo, {
      reactive: getAlpine().reactive,
      dev: this.dev,
      runOutside: (fn) => this.zone.runOutsideAngular(fn),
    });

    const t = this.translateService;
    if (t) {
      this.zone.runOutsideAngular(() =>
        merge(t.onLangChange, t.onTranslationChange, t.onDefaultLangChange).subscribe(() => this.i18n.tick++),
      );
    }

    if (this.dev && this.config.tokenInspector !== false && new URLSearchParams(location.search).has('ndeTokens')) {
      import('@libis/primo-alpine/tokens')
        .then(({ mountTokenInspector }) => mountTokenInspector(getAlpine()))
        .catch((err) => console.error('[primo-alpine] token inspector failed to load', err));
    }
  }

  get dev(): boolean {
    return !!this.config.dev;
  }

  /** `$t`: `TranslateService.instant`, re-evaluated by Alpine when the language or translations change. */
  translate(key: string, params?: Record<string, unknown>): string {
    void this.i18n.tick;
    if (!this.translateService) return key;
    const value = this.translateService.instant(key, params);
    return typeof value === 'string' ? value : key;
  }

  /** `$asset` / `x-asset-src`: prefixes `assets/...` paths with the remote's public path. */
  asset(url: string): string {
    if (!url || /^(https?:)?\/\//i.test(url) || /^(data|blob):/i.test(url)) return url;
    const clean = url.startsWith('/') ? url.slice(1) : url;
    if (!clean.startsWith('assets/')) return url;
    const base = this.config.assetBase?.() ?? '';
    return (base && !base.endsWith('/') ? `${base}/` : base) + clean;
  }
}
