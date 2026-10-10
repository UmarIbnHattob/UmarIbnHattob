"use client";

import { memo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { Image as ImageIcon } from "lucide-react";
import { fileUrl } from "@/lib/mediaApi";
import { useI18n } from "@/lib/i18n";
import CopyButton from "@/components/CopyButton";

const REMARK = [remarkGfm];
const REHYPE_HIGHLIGHT = [rehypeHighlight];
// Chatda yaratilgan rasm: omni-media://<uuid> (boshqa ko'rinishdagi "id" — masalan ../ — qabul qilinmaydi)
const MEDIA_RE = /^omni-media:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// Ichiga joylangan rasm: faqat rastr formatlar va cheklangan hajm
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;
const MAX_DATA_IMAGE = 2_000_000;

const isDataImage = (s: string) => s.length <= MAX_DATA_IMAGE && DATA_IMAGE_RE.test(s);

/** react-markdown komponentlarga `node` (hast tuguni) ham beradi: u DOM atributi bo'lib ketmasin. */
function domProps<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

/** Kod bloki: o'ng yuqori burchakda "nusxa olish" tugmasi (blokning o'zi gorizontal aylanadi). */
function CodeBlock(props: React.HTMLAttributes<HTMLPreElement>) {
  const { t } = useI18n();
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="group/code relative">
      <pre ref={ref} {...props} />
      <CopyButton
        text={() => ref.current?.innerText ?? ""}
        label={t("chat.copyCode")}
        className="absolute right-1.5 top-1.5 bg-white/10 p-1.5 text-[#c9d1d9] opacity-0 hover:bg-white/20 hover:text-white focus-visible:opacity-100 group-hover/code:opacity-100 [@media(hover:none)]:opacity-100"
      />
    </div>
  );
}

/**
 * Tashqi (http/https) rasm avtomatik yuklanmaydi: AI javobidagi rasm manzili orqali ma'lumot sizdirilishi mumkin
 * (prompt-injection). Foydalanuvchi manbani ko'rib, o'zi bosib yuklaydi.
 */
function ExternalImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  let host = src;
  try {
    host = new URL(src).host;
  } catch {
    /* e'tiborsiz */
  }
  if (show) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} referrerPolicy="no-referrer" className="max-h-96 rounded-lg" />;
  }
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400">
      <ImageIcon size={14} className="shrink-0" />
      {alt && <span className="min-w-0 break-words">{alt}</span>}
      <button
        type="button"
        onClick={() => setShow(true)}
        className="rounded bg-neutral-700/60 px-1.5 py-0.5 text-neutral-200 hover:bg-neutral-700"
      >
        {t("chat.loadImage", { host })}
      </button>
    </span>
  );
}

const COMPONENTS: Components = {
  // AI bergan havolalar yangi oynada ochiladi: chat sahifasidan chiqib ketmaslik uchun.
  // Rang ikkala mavzuda ham o'qiladigan (yorug' fonda to'q binafsha)
  a: (props) => (
    <a
      {...domProps(props)}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words !text-sky-300 [:root[data-theme=light]_&]:!text-violet-700"
    />
  ),
  img: ({ src, alt }) => {
    const s = typeof src === "string" ? src : "";
    const media = MEDIA_RE.exec(s);
    // Auto rejimda chatda yaratilgan rasmlar: omni-media://<id> -> Media Studio fayli
    // eslint-disable-next-line @next/next/no-img-element
    if (media) return <img src={fileUrl(media[1])} alt={alt ?? ""} className="develop max-h-96 rounded-lg" />;
    // eslint-disable-next-line @next/next/no-img-element
    if (isDataImage(s)) return <img src={s} alt={alt ?? ""} className="max-h-96 rounded-lg" />;
    if (/^https?:\/\//i.test(s)) return <ExternalImage src={s} alt={alt ?? ""} />;
    return alt ? <span className="text-neutral-500">[{alt}]</span> : null;
  },
  pre: (props) => <CodeBlock {...domProps(props)} />,
  // Keng jadval bubble'dan chiqib ketmaydi: o'zi gorizontal aylanadi
  table: (props) => (
    <div className="max-w-full overflow-x-auto">
      <table {...domProps(props)} />
    </div>
  ),
};
// omni-media:// va ichiga joylangan rasmlar sanitizatsiyada o'chib ketmasligi uchun (boshqalari — standart tekshiruv)
const urlTransform = (url: string, key: string) =>
  MEDIA_RE.test(url) || (key === "src" && isDataImage(url)) ? url : defaultUrlTransform(url);

/**
 * Markdown + kod bloklari.
 * `highlight=false` — oqim paytida rang berishni o'chiradi (har bo'lakda ranglash sekin);
 * javob tugagach `true` bo'ladi va kod ranglanadi.
 */
function Markdown({ children, highlight = true }: { children: string; highlight?: boolean }) {
  return (
    <div className="markdown min-w-0 break-words">
      <ReactMarkdown components={COMPONENTS} urlTransform={urlTransform} remarkPlugins={REMARK} rehypePlugins={highlight ? REHYPE_HIGHLIGHT : []}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
