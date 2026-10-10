"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_TITLE, type Conversation } from "@/lib/chatApi";
import type { useChat } from "@/hooks/useChat";

type Chat = ReturnType<typeof useChat>;

/**
 * Suhbatlar ro'yxati: qidiruv, "yana yuklash", nomini o'zgartirish va tasdiq bilan o'chirish.
 * Amal tugmalari klaviaturada ham (fokusda ko'rinadi), sensorli ekranda va kichik ekranda doim ko'rinadi.
 */
export default function ConversationList({ chat, onPicked }: { chat: Chat; onPicked?: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState(chat.query);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  editingRef.current = editing;
  const { search, query } = chat;

  // Yozish to'xtagach qidiramiz (har harfda so'rov yubormaslik uchun)
  useEffect(() => {
    if (q === query) return;
    const timer = setTimeout(() => search(q), 300);
    return () => clearTimeout(timer);
  }, [q, query, search]);

  const titleOf = (c: Conversation) => (!c.title || c.title === DEFAULT_TITLE ? t("chat.newChat") : c.title);

  function startRename(c: Conversation) {
    setConfirming(null);
    setEditing(c.id);
    setDraft(c.title === DEFAULT_TITLE ? "" : c.title);
  }

  // Enter yoki fokus chiqqanda saqlanadi (bir marta); bo'sh yoki o'zgarmagan nom saqlanmaydi
  function commit(c: Conversation) {
    if (editingRef.current !== c.id) return;
    editingRef.current = null;
    setEditing(null);
    const title = draft.trim();
    if (title && title !== c.title) chat.rename(c.id, title);
  }

  const actions =
    "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-100 [@media(hover:none)]:opacity-100";
  const iconBtn = "rounded p-1 text-neutral-500 max-lg:p-1.5";

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <button
        onClick={() => {
          chat.select(null);
          onPicked?.();
        }}
        className="mb-2 flex shrink-0 items-center justify-center gap-2 rounded-md border border-neutral-700 py-2 text-sm hover:bg-neutral-800"
      >
        <Plus size={14} /> {t("chat.newChat")}
      </button>
      <div className="relative mb-2 shrink-0">
        <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("chat.search")}
          aria-label={t("chat.search")}
          maxLength={200}
          className="w-full rounded-md border border-neutral-800 bg-neutral-950 py-1.5 pl-7 pr-2 text-sm placeholder:text-neutral-500"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto">
        {chat.conversations.map((c) => {
          const active = c.id === chat.activeId;
          return (
            <div
              key={c.id}
              className={`group flex min-h-[2.25rem] items-center gap-1 rounded-md px-2 py-1 text-sm ${
                active ? "bg-neutral-800" : "hover:bg-neutral-900"
              }`}
            >
              {editing === c.id ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={200}
                  aria-label={t("chat.rename")}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => commit(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commit(c);
                    } else if (e.key === "Escape") {
                      // Faqat tahrirni bekor qiladi (panel yopilmaydi)
                      e.preventDefault();
                      e.stopPropagation();
                      editingRef.current = null;
                      setEditing(null);
                    }
                  }}
                  className="min-w-0 flex-1 rounded border border-violet-500/60 bg-neutral-950 px-1.5 py-0.5 text-sm outline-none"
                />
              ) : confirming === c.id ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-xs text-red-500">{t("chat.deleteConfirm")}</span>
                  <button
                    onClick={() => {
                      setConfirming(null);
                      chat.remove(c.id);
                    }}
                    className="shrink-0 rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
                  >
                    {t("common.delete")}
                  </button>
                  <button
                    autoFocus
                    onClick={() => setConfirming(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirming(null);
                      }
                    }}
                    className="shrink-0 rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                  >
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      chat.select(c.id);
                      onPicked?.();
                    }}
                    aria-current={active ? "true" : undefined}
                    title={titleOf(c)}
                    className="min-w-0 flex-1 truncate py-1 text-left"
                  >
                    {titleOf(c)}
                  </button>
                  <div className={`flex shrink-0 items-center ${active ? "opacity-100" : actions}`}>
                    <button
                      onClick={() => startRename(c)}
                      aria-label={t("chat.rename")}
                      title={t("chat.rename")}
                      className={`${iconBtn} hover:text-neutral-50`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => {
                        setEditing(null);
                        setConfirming(c.id);
                      }}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                      className={`${iconBtn} hover:text-red-500`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {chat.listReady && chat.conversations.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-neutral-500">{chat.query ? t("chat.noResults") : t("chat.noChats")}</p>
        )}
        {chat.hasMore && (
          <button
            onClick={chat.loadMore}
            disabled={chat.loadingMore}
            className="flex w-full items-center justify-center gap-2 rounded-md py-2 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-neutral-50 disabled:opacity-60"
          >
            {chat.loadingMore && <Loader2 size={12} className="animate-spin" />}
            {t("chat.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
