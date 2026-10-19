import { CollectOptions, TokenEntry, TokenSnapshot, collectTokens } from './collect';

const TAG = 'primo-token-inspector';

/** The part of Alpine the inspector uses. Passed in, so this entry point does not import the main one. */
export interface InspectorAlpine {
  data<T extends object>(name: string, callback: () => T & ThisType<T>): void;
  initTree(el: Element): void;
  destroyTree(el: Element): void;
  raw<T>(value: T): T;
}

function sampleStyle(t: TokenEntry): Record<string, string> {
  const v = `var(${t.name})`;
  if (t.kind === 'color') return { background: v };
  if (t.kind !== 'font') return {};
  if (/-font$/.test(t.name)) return { 'font-family': v };
  if (/-size$/.test(t.name)) return { 'font-size': v };
  if (/-weight$/.test(t.name)) return { 'font-weight': v };
  if (/-line-height$/.test(t.name)) return { 'line-height': v };
  if (/-tracking$/.test(t.name)) return { 'letter-spacing': v };
  return { font: v };
}

function download(snapshot: TokenSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tokens.${(snapshot.view ?? 'view').replace(/[^\w.-]+/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const STYLE = `
${TAG}{position:fixed;inset:auto 16px 16px auto;z-index:2147483000;width:min(760px,calc(100vw - 32px));max-height:70vh;display:flex;flex-direction:column;
  background:var(--mat-sys-surface-container-high,#fff);color:var(--mat-sys-on-surface,#1b1b1f);border:1px solid var(--mat-sys-outline-variant,#ccc);
  border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.25);font:14px/1.4 system-ui,sans-serif}
${TAG} header{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--mat-sys-outline-variant,#ccc)}
${TAG} header strong{margin-right:auto}
${TAG} input,${TAG} select,${TAG} button{font:inherit;padding:4px 8px;border-radius:6px;border:1px solid var(--mat-sys-outline,#999);background:transparent;color:inherit}
${TAG} button{cursor:pointer}
${TAG} ul{list-style:none;margin:0;padding:6px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px}
${TAG} li{display:flex;gap:8px;align-items:center;padding:6px;border-radius:8px;cursor:copy;min-width:0}
${TAG} li:hover{background:var(--mat-sys-surface-container-highest,#eee)}
${TAG} .sw{flex:none;width:28px;height:28px;border-radius:6px;border:1px solid var(--mat-sys-outline-variant,#ccc);display:grid;place-items:center;overflow:hidden;font-size:12px}
${TAG} .meta{min-width:0}
${TAG} .meta code,${TAG} .meta small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${TAG} code{font:12px ui-monospace,monospace}
${TAG} small{opacity:.7}
${TAG} .copied{padding:0 12px 8px;font-size:12px}
@media (max-width:520px){${TAG}{inset:auto 8px 8px 8px;width:auto}${TAG} header{flex-wrap:wrap}}
`;

const HTML = `
<div x-data="primoTokenInspector" x-show="open">
  <header>
    <strong>Host tokens <small x-text="countLabel"></small></strong>
    <input type="search" placeholder="Filter" x-model="query" aria-label="Filter tokens">
    <select x-model="kind" aria-label="Kind">
      <option value="">All kinds</option><option value="color">Color</option><option value="font">Font</option>
      <option value="length">Length</option><option value="other">Other</option>
    </select>
    <select x-model="theme" aria-label="Theme"><template x-for="t in themes" :key="t"><option :value="t" x-text="t"></option></template></select>
    <button type="button" @click="refresh">Rescan</button>
    <button type="button" @click="exportJson">Export JSON</button>
    <button type="button" @click="close" aria-label="Close">✕</button>
  </header>
  <ul>
    <template x-for="t in visible" :key="t.name">
      <li @click="copy(t)" :title="'Copy var(' + t.name + ')'">
        <span class="sw" :class="t.kind === 'font' ? 'font' : ''" :style="sample(t)" x-text="t.kind === 'font' ? 'Aa' : ''"></span>
        <span class="meta"><code x-text="t.name"></code><small x-text="valueFor(t)"></small></span>
      </li>
    </template>
  </ul>
  <div class="copied" x-show="copied" x-text="'Copied ' + copied"></div>
</div>`;

/**
 * Mounts the dev-only token inspector: a searchable grid of the host's CSS custom properties with
 * swatches, type samples and click-to-copy `var(--...)`. "Export JSON" downloads a snapshot for
 * `primo-alpine tokens import`. Returns an unmount function.
 *
 * `providePrimoAlpine({ dev: true })` mounts it on `?ndeTokens=1`; call it yourself with
 * `mountTokenInspector(getAlpine())` otherwise.
 */
export function mountTokenInspector(Alpine: InspectorAlpine, options: CollectOptions = {}): () => void {
  const existing = document.querySelector(TAG);
  if (existing) return () => existing.remove();

  Alpine.data('primoTokenInspector', () => ({
    open: true,
    query: '',
    kind: '',
    theme: 'default',
    copied: '',
    snapshot: Alpine.raw(collectTokens(options)) as TokenSnapshot,
    get themes(): string[] {
      return this.snapshot.themes;
    },
    get visible(): TokenEntry[] {
      const q = this.query.toLowerCase();
      return this.snapshot.tokens.filter(
        (t) => (!this.kind || t.kind === this.kind) && (!q || t.name.includes(q) || this.valueFor(t).toLowerCase().includes(q)),
      );
    },
    get countLabel(): string {
      return `${this.visible.length} / ${this.snapshot.tokens.length}`;
    },
    valueFor(t: TokenEntry): string {
      return t.values[this.theme] ?? t.values['default'] ?? '';
    },
    sample: sampleStyle,
    refresh() {
      this.snapshot = collectTokens(options);
    },
    exportJson() {
      download(this.snapshot);
    },
    async copy(t: TokenEntry) {
      await navigator.clipboard?.writeText(`var(${t.name})`);
      this.copied = `var(${t.name})`;
    },
    close() {
      unmount();
    },
  }));

  const host = document.createElement(TAG);
  const style = document.createElement('style');
  style.textContent = STYLE;
  host.appendChild(style);
  host.insertAdjacentHTML('beforeend', HTML);
  document.body.appendChild(host);
  Alpine.initTree(host);

  const unmount = () => {
    Alpine.destroyTree(host);
    host.remove();
  };
  return unmount;
}
