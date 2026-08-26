/**
 * Angular's default [innerHTML] sanitizer strips every `style` attribute
 * outright — that's why font-family/color/etc. set from the rich text editor
 * never survive to the public page. This runs its own narrow allow-list pass
 * (typographic + color properties only, values checked for url()/expression()/
 * javascript:) plus the usual script/event-handler/dangerous-URL stripping,
 * so the *output* can be trusted via DomSanitizer.bypassSecurityTrustHtml —
 * we're replacing Angular's blanket style-stripping with our own targeted
 * filter, not skipping sanitization.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'a', 'span', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'hr', 'figure', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'code', 'pre', 'label', 'input'
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'text-align',
  'color',
  'background-color'
]);

const ALLOWED_ATTRIBUTES = new Set([
  'href', 'target', 'rel', 'src', 'alt', 'loading', 'decoding',
  'class', 'id', 'data-type', 'type', 'checked', 'disabled'
]);

const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import/i;

function sanitizeStyleAttribute(value: string): string | null {
  const kept = value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const [rawProperty] = declaration.split(':');
      const property = rawProperty?.trim().toLowerCase();
      return !!property && ALLOWED_STYLE_PROPERTIES.has(property) && !UNSAFE_STYLE_VALUE.test(declaration);
    });

  return kept.length ? kept.join('; ') : null;
}

function cleanElement(el: Element): void {
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    el.remove();
    return;
  }

  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();

    if (name === 'style') {
      const cleaned = sanitizeStyleAttribute(attr.value);
      if (cleaned) {
        el.setAttribute('style', cleaned);
      } else {
        el.removeAttribute('style');
      }
      continue;
    }

    if (!ALLOWED_ATTRIBUTES.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }

    if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }

  Array.from(el.children).forEach(cleanElement);
}

/** Parses `html` with the safe, script-inert DOMParser document (never executes
 *  scripts or loads resources), strips anything outside the allow-lists above,
 *  and returns HTML that is safe to mark trusted with bypassSecurityTrustHtml. */
export function sanitizeRichHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  Array.from(doc.body.children).forEach(cleanElement);
  return doc.body.innerHTML;
}
