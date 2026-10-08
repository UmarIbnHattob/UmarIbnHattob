"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Send, Square, Trash2 } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import Markdown from "@/components/Markdown";
import ModelSelector from "@/components/ModelSelector";

/** To'liq chat oynasi: suhbatlar ro'yxati, xabarlar, model tanlash va kiritish maydoni. */
export default function ChatView() {
  const chat = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  function submit() {
    const text = input;
    setInput("");
    chat.send(text);
  }

  const labelOf = (id: string | null) => chat.models.find((m) => m.id === id)?.label ?? id;

  return (
    <div className="flex h-full">
      <div className="flex w-60 flex-col border-r border-neutral-800 p-2">
        <button
          onClick={() => chat.select(null)}
          className="mb-2 flex items-center justify-center gap-2 rounded-md border border-neutral-700 py-2 text-sm hover:bg-neutral-800"
        >
          <Plus size={14} /> Yangi suhbat
        </button>
        <div className="flex-1 space-y-1 overflow-auto">
          {chat.conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-md px-2 py-1.5 text-sm ${
                c.id === chat.activeId ? "bg-neutral-800" : "hover:bg-neutral-900"
              }`}
            >
              <button onClick={() => chat.select(c.id)} className="flex-1 truncate text-left">
                {c.title}
              </button>
              <button
                onClick={() => chat.remove(c.id)}
                aria-label="O'chirish"
                className="hidden text-neutral-500 hover:text-red-400 group-hover:block"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 p-3">
          <ModelSelector models={chat.models} value={chat.model} onChange={chat.setModel} />
          <span className="text-xs text-neutral-500">Modelni suhbat o‘rtasida ham almashtirishingiz mumkin</span>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {chat.messages.length === 0 && (
            <p className="mt-20 text-center text-neutral-500">Savol yozing, suhbat shu yerda boshlanadi.</p>
          )}
          {chat.messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  m.role === "user" ? "bg-blue-600" : "bg-neutral-800"
                }`}
              >
                {m.role === "assistant" && (
                  <div className="mb-1 text-xs text-neutral-400">{labelOf(m.model)}</div>
                )}
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <Markdown>{m.content || "…"}</Markdown>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {chat.error && (
          <div className="mx-4 mb-2 rounded bg-red-950 p-3 text-sm text-red-300">
            {chat.error}{" "}
            {chat.error.includes("Settings") && (
              <Link href="/settings" className="underline">
                Settings ga o‘tish
              </Link>
            )}
          </div>
        )}

        <div className="flex gap-2 border-t border-neutral-800 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Xabar yozing (Enter — yuborish, Shift+Enter — yangi qator)"
            className="flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm"
          />
          {chat.streaming ? (
            <button onClick={chat.stop} className="rounded-md bg-neutral-700 px-4" aria-label="To'xtatish">
              <Square size={16} />
            </button>
          ) : (
            <button onClick={submit} className="rounded-md bg-blue-600 px-4 hover:bg-blue-500" aria-label="Yuborish">
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
