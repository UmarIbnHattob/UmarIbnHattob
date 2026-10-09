"use client";

import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { fileUrl } from "@/lib/mediaApi";

const REMARK = [remarkGfm];
const REHYPE_HIGHLIGHT = [rehypeHighlight];
// AI bergan havolalar yangi oynada ochiladi: chat sahifasidan chiqib ketmaslik uchun
const COMPONENTS = {
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Auto rejimda chatda yaratilgan rasmlar: omni-media://<id> -> Media Studio fayli
  img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const s = typeof src === "string" ? src : "";
    const real = s.startsWith("omni-media://") ? fileUrl(s.slice("omni-media://".length)) : s;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={real} alt={alt ?? ""} className="develop max-h-96 rounded-lg" />;
  },
};
// omni-media:// manzillari sanitizatsiyada o'chib ketmasligi uchun
const urlTransform = (url: string) => (url.startsWith("omni-media://") ? url : defaultUrlTransform(url));

/**
 * Markdown + kod bloklari.
 * `highlight=false` — oqim paytida rang berishni o'chiradi (har bo'lakda ranglash sekin);
 * javob tugagach `true` bo'ladi va kod ranglanadi.
 */
function Markdown({ children, highlight = true }: { children: string; highlight?: boolean }) {
  return (
    <div className="markdown">
      <ReactMarkdown components={COMPONENTS} urlTransform={urlTransform} remarkPlugins={REMARK} rehypePlugins={highlight ? REHYPE_HIGHLIGHT : []}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
