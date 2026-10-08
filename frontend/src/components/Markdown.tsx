"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

const REMARK = [remarkGfm];
const REHYPE_HIGHLIGHT = [rehypeHighlight];

/**
 * Markdown + kod bloklari.
 * `highlight=false` — oqim paytida rang berishni o'chiradi (har bo'lakda ranglash sekin);
 * javob tugagach `true` bo'ladi va kod ranglanadi.
 */
function Markdown({ children, highlight = true }: { children: string; highlight?: boolean }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={highlight ? REHYPE_HIGHLIGHT : []}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
