import { getAlpine } from './alpine';
import { alpineEvaluatorIsBroken, asyncIsDownleveled } from './evaluator';

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('async-safe evaluator', () => {
  const Alpine = getAlpine() as any;
  let root: HTMLElement | undefined;

  function mount(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    Alpine.initTree(el);
    return (root = el);
  }

  afterEach(() => {
    if (!root) return;
    Alpine.destroyTree(root);
    root.remove();
    root = undefined;
  });

  it('is needed here: Angular CLI with zone.js downlevels async functions', () => {
    // If this ever fails, the bundler stopped downleveling and the fix is simply not installed.
    expect(asyncIsDownleveled()).toBeTrue();
  });

  it('leaves Alpine with a working evaluator (the probe used before installing reports healthy)', () => {
    expect(alpineEvaluatorIsBroken(Alpine)).toBeFalse();
  });

  it('evaluates expressions and reacts to state', async () => {
    const el = mount(`<div x-data="{ n: 1 }"><span x-text="n * 2"></span><button @click="n++"></button></div>`);
    await flush();
    expect(el.querySelector('span')!.textContent).toBe('2');
    el.querySelector('button')!.click();
    await flush();
    expect(el.querySelector('span')!.textContent).toBe('4');
  });

  it('supports await, if-statements and let/const statements', async () => {
    const el = mount(`
      <div x-data="{ a: '', b: '', c: '' }"
           x-init="a = await Promise.resolve('awaited'); if (a) { b = 'if' }; ">
        <i x-init="const x = 'const'; c = x"></i>
        <span class="a" x-text="a"></span><span class="b" x-text="b"></span><span class="c" x-text="c"></span>
      </div>`);
    await flush();
    await flush();
    expect(el.querySelector('.a')!.textContent).toBe('awaited');
    expect(el.querySelector('.b')!.textContent).toBe('if');
    expect(el.querySelector('.c')!.textContent).toBe('const');
  });

  it('calls a function an expression evaluates to (@click="toggle")', async () => {
    const el = mount(`<div x-data="{ open: false, toggle() { this.open = !this.open } }">
      <button @click="toggle"></button><span x-text="open"></span></div>`);
    el.querySelector('button')!.click();
    await flush();
    expect(el.querySelector('span')!.textContent).toBe('true');
  });

  it('works with Alpine.data components, magics and $event', async () => {
    Alpine.data('evaluatorCounter', () => ({ count: 0, add(e: Event) { this.count += e.type === 'click' ? 1 : 0; } }));
    const el = mount(`<div x-data="evaluatorCounter"><button @click="add($event)"></button><span x-text="count + ':' + $el.tagName"></span></div>`);
    el.querySelector('button')!.click();
    await flush();
    expect(el.querySelector('span')!.textContent).toBe('1:SPAN');
  });

  it('reports errors through Alpine.setErrorHandler', async () => {
    const errors: string[] = [];
    Alpine.setErrorHandler((e: Error, _el: Element, expression: string) => errors.push(`${expression}: ${e.message}`));
    try {
      mount(`<div x-data><span x-text="missing.value"></span><b x-text="1 +"></b></div>`);
      await flush();
      expect(errors.some((e) => e.startsWith('missing.value'))).toBeTrue();
      expect(errors.some((e) => e.startsWith('1 +'))).toBeTrue();
    } finally {
      Alpine.setErrorHandler((e: Error, el: Element, expression?: string) =>
        console.warn(`Alpine Expression Error: ${e.message}\n\nExpression: "${expression}"`, el),
      );
    }
  });

  it('supports Alpine.evaluateRaw, including await', async () => {
    const el = mount(`<div x-data="{ n: 20 }"><span></span></div>`);
    const span = el.querySelector('span')!;
    expect(Alpine.evaluateRaw(span, 'n + 1')).toBe(21);
    expect(await Alpine.evaluateRaw(span, 'await Promise.resolve(n + 2)')).toBe(22);
  });
});
