/**
 * Tiny allow-list sanitizer for the personal notes feature. Notes support only
 * bold / italic / underline plus the structural tags the browser's rich-text
 * editing inserts (line breaks, divs, paragraphs, spans). Everything else —
 * scripts, styles, attributes (incl. inline event handlers and `style`), and
 * any other tag — is stripped, so the stored HTML is safe to render back.
 */
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'div', 'p', 'span']);

export function sanitizeNoteHtml(input: string): string {
  let html = input.slice(0, 20_000);

  // Drop entire <script>/<style> blocks (tag + contents).
  html = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

  // Walk every tag: keep allowed ones (without any attributes), drop the rest
  // (keeping their inner text).
  html = html.replace(/<(\/?)([a-zA-Z0-9]+)\b[^>]*>/g, (_m, slash: string, tag: string) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    return `<${slash}${name}>`;
  });

  return html;
}
