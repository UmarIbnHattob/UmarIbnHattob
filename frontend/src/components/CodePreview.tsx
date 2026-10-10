"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ChatMessage } from "@/lib/chatApi";
import { buildSrcDoc, latestWebCode, type WebCode } from "@/lib/codeBlocks";
import { useI18n } from "@/lib/i18n";

/** AI yozgan HTML/CSS/JS ni xavfsiz iframe ichida jonli ko'rsatadi. */
export default function CodePreview({ messages, streaming }: { messages: ChatMessage[]; streaming: boolean }) {
  const { t } = useI18n();
  const [reload, setReload] = useState(0);
  // Javob yozilayotganda qayta chizmaymiz: oldingi natija turadi, tugagach yangilanadi.
  // (Boshqa suhbatga o'tilganda esa o'sha suhbatning kodi ko'rsatiladi — eski kod qolib ketmaydi.)
  const stable = useRef<WebCode | null>(null);
  const shown = useMemo(() => {
    if (!streaming) stable.current = latestWebCode(messages);
    return stable.current;
  }, [messages, streaming]);
  const srcDoc = useMemo(() => (shown ? buildSrcDoc(shown) : ""), [shown]);
  const writing = streaming && (
    <span className="flex items-center gap-1 text-xs text-blue-300">
      <Loader2 size={12} className="animate-spin" /> {t("preview.writing")}
    </span>
  );
  if (!shown) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-neutral-500">
        {writing}
        <p>
          {t("preview.empty")}
          <br />
          {t("preview.example")}
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 p-1">
        <span className="pl-2">{writing}</span>
        <button
          onClick={() => setReload((n) => n + 1)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          <RefreshCw size={12} /> {t("preview.rerun")}
        </button>
      </div>
      {/* sandbox: allow-same-origin YO'Q — kod ilovaning cookie/localStorage ga kira olmaydi */}
      <iframe
        key={reload}
        title={t("preview.iframeTitle")}
        sandbox="allow-scripts allow-forms allow-modals"
        srcDoc={srcDoc}
        className="min-h-0 flex-1 bg-white"
      />
    </div>
  );
}
