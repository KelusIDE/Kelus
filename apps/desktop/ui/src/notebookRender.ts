import { marked } from 'marked';
import DOMPurify from 'dompurify';

DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
});

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function joinText(value: unknown): string {
  if (Array.isArray(value)) return value.join('');
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
}

export function renderMarkdown(source: string): string {
  // Keep TeX intact: marked would otherwise read `_` and `*` inside math as emphasis.
  const math: string[] = [];
  const protectedSource = source.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, match => `KELUSMATH${math.push(match) - 1}X`);
  const html = marked.parse(protectedSource, { async: false, gfm: true }) as string;
  const restored = html.replace(/KELUSMATH(\d+)X/g, (_m, index) => `<span class="nb-math">${escapeHtml(math[Number(index)])}</span>`);
  return DOMPurify.sanitize(restored);
}

/** Terminal-style text: CRLF normalised, then each line keeps only what follows its last carriage return (progress bars). */
export function terminalText(text: string): string {
  return text.replace(/\r\n/g, '\n').split('\n').map(line => {
    if (!line.includes('\r')) return line;
    const parts = line.split('\r');
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i]) return parts[i];
    return '';
  }).join('\n');
}

const palette = ['#3b3b3b', '#e06c75', '#98c379', '#d19a66', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
  '#5c6370', '#ef7b85', '#a8d68a', '#e5c07b', '#7cc0ff', '#d895ee', '#67d0db', '#ffffff'];
function color256(n: number): string {
  if (n < 16) return palette[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
  const i = n - 16, steps = [0, 95, 135, 175, 215, 255];
  return `rgb(${steps[Math.floor(i / 36)]},${steps[Math.floor(i / 6) % 6]},${steps[i % 6]})`;
}
export function ansiToHtml(text: string): string {
  let fg: string | null = null, bg: string | null = null, bold = false, underline = false;
  let html = '';
  const pattern = /\x1b\[([\d;]*)m/g;
  let last = 0, match: RegExpExecArray | null;
  const push = (chunk: string) => {
    if (!chunk) return;
    const style = [fg && `color:${fg}`, bg && `background:${bg}`, bold && 'font-weight:600', underline && 'text-decoration:underline'].filter(Boolean).join(';');
    html += style ? `<span style="${style}">${escapeHtml(chunk)}</span>` : escapeHtml(chunk);
  };
  while ((match = pattern.exec(text))) {
    push(text.slice(last, match.index)); last = pattern.lastIndex;
    const codes = match[1] ? match[1].split(';').map(Number) : [0];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) { fg = bg = null; bold = underline = false; }
      else if (code === 1) bold = true;
      else if (code === 4) underline = true;
      else if (code === 22) bold = false;
      else if (code === 24) underline = false;
      else if (code >= 30 && code <= 37) fg = palette[code - 30];
      else if (code >= 90 && code <= 97) fg = palette[code - 82];
      else if (code >= 40 && code <= 47) bg = palette[code - 40];
      else if (code >= 100 && code <= 107) bg = palette[code - 92];
      else if (code === 39) fg = null;
      else if (code === 49) bg = null;
      else if ((code === 38 || code === 48) && codes[i + 1] === 5) { const c = color256(codes[i + 2] ?? 0); if (code === 38) fg = c; else bg = c; i += 2; }
      else if ((code === 38 || code === 48) && codes[i + 1] === 2) { const c = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`; if (code === 38) fg = c; else bg = c; i += 4; }
    }
  }
  push(text.slice(last).replace(/\x1b\[[\d;]*[A-Za-z]/g, ''));
  return html;
}

export type RichKind = 'html' | 'png' | 'jpeg' | 'svg' | 'markdown' | 'latex' | 'json' | 'text' | 'none';
export function pickMime(data: Record<string, unknown> | undefined): { kind: RichKind; value: string } {
  if (!data) return { kind: 'none', value: '' };
  if (data['text/html'] != null) return { kind: 'html', value: joinText(data['text/html']) };
  if (data['image/png'] != null) return { kind: 'png', value: joinText(data['image/png']).replace(/\s/g, '') };
  if (data['image/jpeg'] != null) return { kind: 'jpeg', value: joinText(data['image/jpeg']).replace(/\s/g, '') };
  if (data['image/svg+xml'] != null) return { kind: 'svg', value: joinText(data['image/svg+xml']) };
  if (data['text/markdown'] != null) return { kind: 'markdown', value: joinText(data['text/markdown']) };
  if (data['text/latex'] != null) return { kind: 'latex', value: joinText(data['text/latex']) };
  if (data['application/json'] != null) return { kind: 'json', value: JSON.stringify(data['application/json'], null, 2) };
  if (data['text/plain'] != null) return { kind: 'text', value: joinText(data['text/plain']) };
  return { kind: 'none', value: '' };
}

/** Full document for a sandboxed (opaque-origin) iframe; reports its height to the parent. */
export function outputDocument(body: string, frameId: string): string {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: transparent; color: ${v('--text', '#ddd')}; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-x: auto; overflow-y: hidden; }
a { color: ${v('--accent', '#6af')}; }
table { border-collapse: collapse; border: none !important; font-size: 12px; font-variant-numeric: tabular-nums; margin: 2px 0; }
th, td { padding: 4px 10px; text-align: right; border: 0 !important; border-bottom: 1px solid ${v('--border', '#444')} !important; white-space: nowrap; }
thead th { font-weight: 600; border-bottom: 1px solid ${v('--border-strong', '#666')} !important; }
tbody tr:nth-child(odd) { background: rgba(127,127,127,0.07); }
tbody tr:hover { background: rgba(127,127,127,0.16); }
tbody th { font-weight: 600; }
img { max-width: 100%; }
</style></head><body>${body}<script>
(function () {
  function report() {
    var h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    parent.postMessage({ kelusFrame: ${JSON.stringify(frameId)}, height: h }, '*');
  }
  new ResizeObserver(report).observe(document.documentElement);
  window.addEventListener('load', report);
  setInterval(report, 1000);
  report();
})();
</script></body></html>`;
}
