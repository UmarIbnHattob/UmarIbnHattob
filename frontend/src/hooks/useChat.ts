"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/chatApi";
import { RequestError } from "@/lib/api";

const MODEL_KEY = "omniai-model";

/** Chat holati: suhbatlar, xabarlar, tanlangan model va oqimli yuborish. */
export function useChat() {
  const [models, setModels] = useState<api.ModelInfo[]>([]);
  const [model, setModel] = useState<string>("");
  const [conversations, setConversations] = useState<api.Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<api.ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Har bir yuborish/suhbat almashuvi raqamni oshiradi: eski oqimning kechikkan bo'laklari yangi suhbatga yozilmaydi
  const runRef = useRef(0);

  const refreshConversations = useCallback(async () => {
    setConversations(await api.getConversations());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.getModels();
        setModels(list);
        // Oxirgi tanlangan modelni eslab qolamiz (faqat shu brauzerda)
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(MODEL_KEY);
        } catch {
          /* localStorage bloklangan bo'lishi mumkin */
        }
        setModel(list.some((m) => m.id === saved) ? saved! : (list[0]?.id ?? ""));
        await refreshConversations();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [refreshConversations]);

  const chooseModel = useCallback((id: string) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* e'tiborsiz */
    }
  }, []);

  const select = useCallback(async (id: string | null) => {
    // Javob yozilayotgan bo'lsa to'xtatamiz: aks holda bo'laklar yangi suhbatga yozilib qoladi.
    // (Server qisman javobni o'zi saqlaydi.)
    abortRef.current?.abort();
    runRef.current++;
    setActiveId(id);
    setError(null);
    try {
      setMessages(id ? await api.getMessages(id) : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.deleteConversation(id);
        if (id === activeId) await select(null);
        await refreshConversations();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activeId, select, refreshConversations],
  );

  const send = useCallback(
    async (text: string, image: string | null = null) => {
      if (!text.trim() || streaming || !model) return;
      setError(null);
      setRestoreText(null);
      setStreaming(true);
      const run = ++runRef.current;
      const current = () => runRef.current === run;

      // Kelgan bo'laklarni yig'ib, ~50 ms da bir marta ekranga chiqaramiz:
      // har bo'lakda qayta chizish uzun javobda brauzerni qotiradi
      let pending = "";
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (!pending || !current()) return;
        const chunk = pending;
        pending = "";
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
      };

      try {
        let id = activeId;
        if (!id) {
          id = (await api.createConversation()).id;
          setActiveId(id);
        }
        // Foydalanuvchi xabari va bo'sh javob o'rni darhol ko'rinadi
        setMessages((m) => [
          ...m,
          { id: `u-${Date.now()}`, role: "user", content: text, model: null, has_canvas: !!image },
          { id: `a-${Date.now()}`, role: "assistant", content: "", model },
        ]);
        abortRef.current = new AbortController();
        await api.streamMessage(
          id,
          text,
          model,
          image,
          (delta) => {
            pending += delta;
            timer ??= setTimeout(flush, 50);
          },
          abortRef.current.signal,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          /* foydalanuvchi to'xtatdi */
        } else if (e instanceof RequestError) {
          // Server so'rovni rad etdi (xabar saqlanmadi): pufakchalarni olib, matnni qaytaramiz
          if (current()) setMessages((m) => m.slice(0, -2));
          setRestoreText(text);
          setError(e.message);
        } else {
          setError((e as Error).message);
        }
      } finally {
        if (timer) clearTimeout(timer);
        flush();
        setStreaming(false);
        // Bo'sh qolgan javob o'rnini olib tashlaymiz
        if (current()) setMessages((m) =>
          m.length && m[m.length - 1].role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m,
        );
        refreshConversations().catch(() => {});
      }
    },
    [activeId, model, streaming, refreshConversations],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { restoreText, models, model, setModel: chooseModel, conversations, activeId, messages, streaming, error, select, remove, send, stop };
}
