/** Chat javoblaridagi HTML/CSS/JS kod bloklarini topib, iframe uchun to'liq sahifa yig'adi. */
import type { ChatMessage } from "@/lib/chatApi";

export type WebCode = { html: string; css: string; js: string };

const LANG: Record<string, keyof WebCode> = {
  html: "html",
  css: "css",
  js: "js",
  javascript: "js",
};

/** Yopilgan ```til ... ``` bloklarini o'qiydi. */
function parseBlocks(markdown: string): WebCode {
  const out: WebCode = { html: "", css: "", js: "" };
  for (const m of markdown.matchAll(/```(\w+)[^\n]*\n([\s\S]*?)```/g)) {
    const key = LANG[m[1].toLowerCase()];
    if (key) out[key] += (out[key] ? "\n" : "") + m[2];
  }
  return out;
}

/** Eng oxirgi (veb-kod bor) assistant javobidan kodni oladi. */
export function latestWebCode(messages: ChatMessage[]): WebCode | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const code = parseBlocks(messages[i].content);
    if (code.html || code.css || code.js) return code;
  }
  return null;
}

/** html/css/js dan iframe `srcDoc` yig'adi. */
export function buildSrcDoc({ html, css, js }: WebCode): string {
  const style = css ? `<style>${css}</style>` : "";
  const script = js ? `<script>${js}<\/script>` : "";
  if (/<html[\s>]|<!doctype/i.test(html)) {
    let doc = html;
    if (style) doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, `${style}</head>`) : style + doc;
    if (script) doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, `${script}</body>`) : doc + script;
    return doc;
  }
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${html}${script}</body></html>`;
}
