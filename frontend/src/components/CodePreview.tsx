"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ChatMessage } from "@/lib/chatApi";
import { buildSrcDoc, latestWebCode } from "@/lib/codeBlocks";

/** AI yozgan HTML/CSS/JS ni xavfsiz iframe ichida jonli ko'rsatadi. */
export default function CodePreview({ messages, streaming }: { messages: ChatMessage[]; streaming: boolean }) {
  const [reload, setReload] = useState(0);
  // Javob yozilayotganda qayta chizmaymiz: faqat yakunlangach yangilanadi
  const code = useMemo(() => (streaming ? null : latestWebCode(messages)), [messages, streaming]);
  const [lastCode, setLastCode] = useState<typeof code>(null);
  if (code && code !== lastCode) setLastCode(code);

  const shown = code ?? lastCode;
  if (!shown) {
    return (
      <p className="p-6 text-center text-sm text-neutral-500">
        AI HTML/CSS/JS kod yozganda, natija shu yerda avtomatik ko‘rinadi.
        <br />
        Masalan: “oddiy kalkulyator sahifasini yoz”.
      </p>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end border-b border-neutral-800 p-1">
        <button
          onClick={() => setReload((n) => n + 1)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          <RefreshCw size={12} /> Qayta ishga tushirish
        </button>
      </div>
      {/* sandbox: allow-same-origin YO'Q — kod ilovaning cookie/localStorage ga kira olmaydi */}
      <iframe
        key={reload}
        title="Live preview"
        sandbox="allow-scripts allow-forms allow-modals"
        srcDoc={buildSrcDoc(shown)}
        className="min-h-0 flex-1 bg-white"
      />
    </div>
  );
}
