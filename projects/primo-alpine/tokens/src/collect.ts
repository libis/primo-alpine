export type TokenKind = 'color' | 'length' | 'font' | 'other';

export interface TokenEntry {
  /** Custom property name, e.g. `--mat-sys-primary`. */
  name: string;
  /** Group derived from the name, e.g. `mat-sys`. */
  group: string;
  kind: TokenKind;
  /** Resolved value per theme; `default` is the page as loaded. */
  values: Record<string, string>;
}

export interface TokenSnapshot {
  format: 'primo-alpine-tokens@1';
  collectedAt: string;
  url: string;
  /** `vid` of the view the snapshot was taken in, when known. */
  view?: string;
  themes: string[];
  tokens: TokenEntry[];
}

export interface CollectOptions {
  /** Extra theme classes to resolve besides the ones detected in the stylesheets. */
  themeClasses?: string[];
  /** Only keep tokens whose name starts with one of these prefixes. Default: all. */
  prefixes?: string[];
}

const ROOT_SELECTOR = /^(:root|html|body)$/;
const THEME_SELECTOR = /^(?:(?::root|html|body))?\.([\w-]*(?:theme|dark|light)[\w-]*)$/i;
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|light-dark|color-mix)\(|transparent$|currentcolor$)/i;
const LENGTH = /^-?[\d.]+(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|cm|mm|in)?$/i;
const FONT_NAME = /font|typeface|weight|line-height|tracking|(^|-)(body|title|label|headline|display)-(small|medium|large)/i;

/**
 * Collects the CSS custom properties the host page defines on `:root`, `html`, `body` and theme
 * classes, resolved with `getComputedStyle`. Cross-origin stylesheets (fonts) are skipped.
 */
export function collectTokens(options: CollectOptions = {}): TokenSnapshot {
  const names = new Set<string>();
  const themes = new Set(options.themeClasses ?? []);

  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const selectors = rule.selectorText.split(',').map((s) => s.trim());
        const isRoot = selectors.some((s) => ROOT_SELECTOR.test(s));
        const theme = selectors.map((s) => THEME_SELECTOR.exec(s)?.[1]).find(Boolean);
        if (!isRoot && !theme) continue;
        let declares = false;
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          if (prop.startsWith('--')) {
            names.add(prop);
            declares = true;
          }
        }
        if (theme && declares) themes.add(theme);
      } else if ('cssRules' in rule) {
        visit((rule as CSSGroupingRule).cssRules); // @media, @layer, @supports, @container
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      // cross-origin stylesheet
    }
  }

  const prefixes = options.prefixes;
  const kept = [...names].filter((n) => !prefixes || prefixes.some((p) => n.startsWith(p))).sort();

  // Islands render inside <body>, where hosts (NDE included) put their theme class, so the page as
  // loaded is resolved there. Themes already applied to <html>/<body> are part of that default.
  const resolvers: Record<string, (name: string) => string> = { default: resolverFor(document.body) };
  const applied = (theme: string) => document.body.classList.contains(theme) || document.documentElement.classList.contains(theme);
  const probes: HTMLElement[] = [];
  for (const theme of [...themes].filter((t) => !applied(t))) {
    const probe = document.createElement('div');
    probe.className = theme;
    probe.hidden = true;
    document.body.appendChild(probe);
    probes.push(probe);
    resolvers[theme] = resolverFor(probe);
  }

  const tokens = kept.map((name): TokenEntry => {
    const values: Record<string, string> = {};
    for (const [theme, resolve] of Object.entries(resolvers)) {
      const value = resolve(name);
      if (theme === 'default' || value !== values['default']) values[theme] = value;
    }
    const sample = Object.values(values).find(Boolean) ?? '';
    return { name, group: groupOf(name), kind: kindOf(name, sample), values };
  });

  probes.forEach((p) => p.remove());

  return {
    format: 'primo-alpine-tokens@1',
    collectedAt: new Date().toISOString(),
    url: location.href,
    view: new URLSearchParams(location.search).get('vid') ?? undefined,
    themes: Object.keys(resolvers),
    tokens,
  };
}

function resolverFor(el: Element): (name: string) => string {
  const style = getComputedStyle(el);
  return (name) => style.getPropertyValue(name).trim();
}

export function groupOf(name: string): string {
  return name.replace(/^--/, '').split('-').slice(0, 2).join('-');
}

export function kindOf(name: string, value: string): TokenKind {
  if (FONT_NAME.test(name)) return 'font';
  if (COLOR.test(value)) return 'color';
  if (LENGTH.test(value)) return 'length';
  return 'other';
}
