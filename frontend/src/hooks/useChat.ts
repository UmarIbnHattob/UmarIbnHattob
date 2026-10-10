"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/chatApi";
import { RequestError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const MODEL_KEY = "omniai-model";
// Yuborishdan keyingi shu vaqt ichida "To'xtatish" e'tiborsiz: "Yuborish" ni ikki marta bosish javobni bekor qilmasin
const STOP_GUARD_MS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Suhbat topilmadi (o'chirilgan yoki boshqa foydalanuvchiniki): server 404 qaytaradi. 500/502 bu emas. */
const isNotFound = (e: unknown) => e instanceof RequestError && e.status === 404;

/** Faol suhbat manzilda turadi (/chat?c=<id>): sahifa qayta yuklansa o'sha suhbat ochiladi. */
function syncUrl(id: string | null) {
  try {
    const url = new URL(window.location.href);
    if (!url.pathname.startsWith("/chat")) return; // foydalanuvchi boshqa sahifaga o'tib ulgurgan
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* e'tiborsiz */
  }
}

/** Chat holati: suhbatlar, xabarlar, tanlangan model va oqimli yuborish. */
export function useChat(defaultModel: string | null = null) {
  const { t } = useI18n();
  const [models, setModels] = useState<api.ModelInfo[]>([]);
  const [model, setModel] = useState<string>("");
  const [conversations, setConversations] = useState<api.Conversation[]>([]);
  const [listReady, setListReady] = useState(false); // ro'yxat hech bo'lmasa bir marta yuklandi
  const [query, setQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<api.ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Har bir yuborish/suhbat almashuvi raqamni oshiradi: eski oqimning kechikkan bo'laklari yangi suhbatga yozilmaydi
  const runRef = useRef(0);
  // State keyingi chizishda yangilanadi: ikki marta tez bosishni shu ref to'xtatadi
  const streamingRef = useRef(false);
  const sentAtRef = useRef(0);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  // Ro'yxat so'rovlari: eskirgan javob (masalan, qidiruv tez o'zgarganda) yangisini bosib ketmasin
  const listRunRef = useRef(0);
  const queryRef = useRef("");
  const loadedRef = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;

  /** Foydalanuvchiga ko'rsatiladigan xato matni (tarmoq xatolari tarjima qilinadi). */
  const describe = useCallback((e: unknown) => {
    if (e instanceof api.ConnectionError) return tRef.current(e.sent ? "chat.connectionLost" : "chat.offline");
    return (e as Error).message;
  }, []);

  const refreshConversations = useCallback(async () => {
    const run = ++listRunRef.current;
    // Oldin "Yana yuklash" bilan ochilgan sahifalar ham qolsin
    const limit = Math.min(200, Math.max(api.PAGE_SIZE, loadedRef.current));
    const list = await api.getConversations({ q: queryRef.current, limit });
    if (run !== listRunRef.current) return;
    loadedRef.current = list.length;
    setConversations(list);
    setHasMore(list.length === limit);
    setListReady(true);
  }, []);

  const loadMore = useCallback(async () => {
    const last = conversations[conversations.length - 1];
    if (!last || loadingMore) return;
    const run = listRunRef.current;
    setLoadingMore(true);
    try {
      const page = await api.getConversations({ q: queryRef.current, after: last });
      if (run !== listRunRef.current) return;
      setConversations((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const next = [...prev, ...page.filter((c) => !seen.has(c.id))];
        loadedRef.current = next.length;
        return next;
      });
      setHasMore(page.length === api.PAGE_SIZE);
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoadingMore(false);
    }
  }, [conversations, loadingMore, describe]);

  /** Sarlavha bo'yicha qidiruv (bo'sh matn — hammasi). */
  const search = useCallback(
    (q: string) => {
      queryRef.current = q;
      loadedRef.current = 0;
      setQuery(q);
      refreshConversations().catch((e) => setError(describe(e)));
    },
    [refreshConversations, describe],
  );

  const chooseModel = useCallback((id: string) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* e'tiborsiz */
    }
  }, []);

  /** Joriy suhbatdan chiqib, yangi (bo'sh) suhbatga o'tadi. `notice` — nima uchunligi (masalan, suhbat o'chirilgan). */
  const resetToNew = useCallback(
    (notice: string | null) => {
      setActiveId(null);
      syncUrl(null);
      setMessages([]);
      setError(notice);
      refreshConversations().catch(() => {});
    },
    [refreshConversations],
  );

  const select = useCallback(
    async (id: string | null, { quiet = false }: { quiet?: boolean } = {}) => {
      // Javob yozilayotgan bo'lsa to'xtatamiz: aks holda bo'laklar yangi suhbatga yozilib qoladi.
      // (Server qisman javobni o'zi saqlaydi.)
      abortRef.current?.abort();
      const run = ++runRef.current;
      streamingRef.current = false;
      setStreaming(false);
      setActiveId(id);
      syncUrl(id);
      // Yangi suhbat standart model bilan boshlanadi
      if (id === null && defaultModel) setModel(defaultModel);
      setError(null);
      if (!id) {
        setMessages([]);
        return;
      }
      try {
        const list = await api.getMessages(id);
        if (run === runRef.current) setMessages(list);
      } catch (e) {
        if (run !== runRef.current) return;
        // Suhbat topilmadi (boshqa oynada o'chirilgan yoki manzildagi id noto'g'ri): yangi suhbat ochiladi
        if (isNotFound(e)) resetToNew(quiet ? null : tRef.current("chat.convGone"));
        else setError(describe(e));
      }
    },
    [defaultModel, describe, resetToNew],
  );

  useEffect(() => {
    // Sahifa qayta yuklanganda faol suhbat manzildan tiklanadi; noma'lum id jimgina e'tiborsiz qoldiriladi
    const fromUrl = new URLSearchParams(window.location.search).get("c");
    const restoring = !!fromUrl && UUID_RE.test(fromUrl);
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
        // Yangi suhbat: sozlamalardagi standart model > shu brauzerda oxirgi tanlangan > Auto.
        // Suhbat manzildan tiklansa (reload) — u yangi emas: oxirgi tanlangan model saqlanib qoladi
        const order = restoring ? [saved, defaultModel] : [defaultModel, saved];
        const pick = order.find((id) => id && (id === "auto" || list.some((m) => m.id === id)));
        setModel(pick ?? "auto");
      } catch (e) {
        setError(describe(e));
      }
    })();
    refreshConversations().catch((e) => setError(describe(e)));
    if (restoring && fromUrl) select(fromUrl, { quiet: true });
    else if (fromUrl) syncUrl(null);
  }, [refreshConversations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Shift+O (yoki desktop menyusi) — yangi suhbat
  useEffect(() => {
    const onNew = () => select(null);
    window.addEventListener("omni:new-chat", onNew);
    return () => window.removeEventListener("omni:new-chat", onNew);
  }, [select]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.deleteConversation(id);
        if (id === activeRef.current) await select(null);
        setConversations((list) => list.filter((c) => c.id !== id));
      } catch (e) {
        setError(describe(e));
      }
      refreshConversations().catch(() => {});
    },
    [select, refreshConversations, describe],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      // Darhol ko'rinsin, keyin server javobi bilan tasdiqlanadi
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, title: clean } : c)));
      try {
        const saved = await api.renameConversation(id, clean);
        setConversations((list) => list.map((c) => (c.id === id ? { ...c, title: saved.title } : c)));
      } catch (e) {
        setError(describe(e));
        refreshConversations().catch(() => {});
      }
    },
    [refreshConversations, describe],
  );

  /** Suhbat hali bormi? (Xatodan keyin: boshqa oynada o'chirilgan bo'lsa yangi suhbatga o'tamiz.) */
  const isGone = useCallback(async (id: string) => {
    try {
      await api.getMessages(id);
      return false;
    } catch (e) {
      return isNotFound(e);
    }
  }, []);

  const send = useCallback(
    async (text: string, image: string | null = null) => {
      if (!text.trim() || streamingRef.current || !model) return;
      streamingRef.current = true;
      sentAtRef.current = Date.now();
      setError(null);
      setRestoreText(null);
      setStreaming(true);
      const run = ++runRef.current;
      const current = () => runRef.current === run;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const uid = `u-${run}-${Date.now()}`;
      const aid = `a-${run}-${Date.now()}`;
      let received = false;

      // Kelgan bo'laklarni yig'ib, ~50 ms da bir marta ekranga chiqaramiz:
      // har bo'lakda qayta chizish uzun javobda brauzerni qotiradi
      let pending = "";
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (!pending || !current()) return;
        const chunk = pending;
        pending = "";
        setMessages((m) => m.map((x) => (x.id === aid ? { ...x, content: x.content + chunk } : x)));
      };
      // Javob matni kelmagan navbat: pufakchalar olinadi, yozilgan matn kiritish maydoniga qaytadi
      const undoTurn = () => {
        if (!current()) return;
        setMessages((m) => m.filter((x) => x.id !== uid && x.id !== aid));
        setRestoreText(text);
      };

      // Foydalanuvchi xabari va bo'sh javob o'rni darhol ko'rinadi (yangi suhbat yaratilishini kutmasdan)
      setMessages((m) => [
        ...m,
        { id: uid, role: "user", content: text, model: null, has_canvas: !!image },
        { id: aid, role: "assistant", content: "", model },
      ]);

      let id = activeId;
      let created = false;
      try {
        if (!id) {
          id = (await api.createConversation()).id;
          created = true;
          if (ctrl.signal.aborted) throw new DOMException("Aborted", "AbortError");
          setActiveId(id);
          syncUrl(id);
        }
        await api.streamMessage(
          id,
          text,
          model,
          image,
          (delta) => {
            if (delta) received = true;
            pending += delta;
            timer ??= setTimeout(flush, 50);
          },
          ctrl.signal,
          // Auto rejim: server qaysi modelni (va nima uchun) tanlaganini aytadi
          (routed, route) =>
            current() && setMessages((m) => m.map((x) => (x.id === aid ? { ...x, model: routed, route } : x))),
        );
      } catch (e) {
        if (timer) clearTimeout(timer);
        flush();
        // Birinchi xabari saqlanmagan yangi suhbat ro'yxatda bo'sh "Yangi suhbat" bo'lib qolmasin
        const dropCreated = async () => {
          if (!created || !id) return;
          await api.deleteConversation(id).catch(() => {});
          if (current()) {
            setActiveId(null);
            syncUrl(null);
          }
        };
        const keepTurn = received; // qisman javob serverda saqlangan
        if ((e as Error).name === "AbortError") {
          // Foydalanuvchi to'xtatdi (yoki boshqa suhbatga o'tdi): matn kelmagan bo'lsa server savolni ham o'chirgan
          if (!keepTurn) {
            undoTurn();
            await dropCreated();
          }
        } else if (e instanceof api.ConnectionError) {
          if (current()) setError(describe(e));
          if (!keepTurn) {
            undoTurn();
            await dropCreated();
          }
        } else if (e instanceof RequestError || (e instanceof api.StreamError && e.userMessageRemoved)) {
          // Server so'rovni rad etdi yoki javob bo'lmadi (savol saqlanmadi)
          undoTurn();
          if (current()) setError(e.message);
          await dropCreated();
          // Suhbat boshqa oynada o'chirilgan bo'lsa (404), yangi suhbatga o'tamiz
          if (!created && id && e instanceof RequestError && current() && (await isGone(id)) && current()) {
            resetToNew(tRef.current("chat.convGone"));
          }
        } else {
          if (current()) setError(describe(e));
          // Javob davomida suhbat o'chirib yuborilgan bo'lishi mumkin
          if (id && current() && (await isGone(id)) && current()) {
            resetToNew(tRef.current("chat.convGone"));
            setRestoreText(text);
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
        flush();
        if (abortRef.current === ctrl) abortRef.current = null;
        if (current()) {
          streamingRef.current = false;
          setStreaming(false);
          // Bo'sh qolgan javob o'rnini olib tashlaymiz
          setMessages((m) => m.filter((x) => !(x.id === aid && !x.content)));
        }
        refreshConversations().catch(() => {});
      }
    },
    [activeId, model, refreshConversations, describe, isGone, resetToNew],
  );

  const stop = useCallback(() => {
    if (Date.now() - sentAtRef.current < STOP_GUARD_MS) return;
    abortRef.current?.abort();
  }, []);

  return {
    restoreText,
    models,
    model,
    setModel: chooseModel,
    conversations,
    listReady,
    query,
    search,
    hasMore,
    loadMore,
    loadingMore,
    activeId,
    messages,
    streaming,
    error,
    setError,
    select,
    remove,
    rename,
    send,
    stop,
  };
}
