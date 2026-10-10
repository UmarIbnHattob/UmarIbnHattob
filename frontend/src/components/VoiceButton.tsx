"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { blobToWavBase64 } from "@/lib/wav";
import { useI18n, type TKey } from "@/lib/i18n";

const MAX_SECONDS = 120;
type Phase = "idle" | "recording" | "transcribing";

/** getUserMedia xatosi -> tushunarli sabab (mikrofon yo'q / ruxsat yo'q / boshqa). */
function micErrorKey(e: unknown): TKey {
  const name = (e as Error)?.name;
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "voice.noMic";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "voice.denied";
  return "voice.micError";
}

/**
 * Ovozli buyruq: bosing — gapiring — yana bosing. Matn kiritish maydoniga qo'shiladi.
 * Yozish paytida ovoz balandligiga qarab "raqsga tushadigan" rangli to'lqin ko'rinadi.
 */
export default function VoiceButton({ onText, onError }: { onText: (t: string) => void; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [sec, setSec] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelled = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Mikrofon ruxsati kutilayotganda ikkinchi bosish ikkinchi oqim ochmasin
  const startingRef = useRef(false);
  const aliveRef = useRef(true);
  const transcribeRef = useRef<AbortController | null>(null);
  // Eng so'nggi callbacklar: yozuv boshlangan paytdagi eski holat (suhbat, model, matn) ishlatilmasin
  const onTextRef = useRef(onText);
  const onErrorRef = useRef(onError);
  onTextRef.current = onText;
  onErrorRef.current = onError;

  const cleanup = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioCtxRef.current = null;
  };
  // Sahifadan chiqildi (yoki komponent yopildi): yozuv bekor, matnga aylantirish to'xtatiladi, hech narsa yuborilmaydi
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelled.current = true;
      transcribeRef.current?.abort();
      if (recRef.current?.state === "recording") recRef.current.stop();
      cleanup();
    };
  }, []);

  // Taymer va avtomatik to'xtash
  useEffect(() => {
    if (phase !== "recording") return;
    setSec(0);
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === "recording" && sec >= MAX_SECONDS) stop();
  }, [sec, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc — bekor qilish. Lekin avval ochiq qatlam (model tanlagich, menyu, oyna) yopiladi:
  // fokus o'sha qatlam ichida bo'lsa yoki modal oyna ochiq bo'lsa yozuvga tegmaymiz
  useEffect(() => {
    if (phase !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement;
      const free = !el || el === document.body || el.tagName === "TEXTAREA" || !!widgetRef.current?.contains(el);
      if (!free || document.querySelector('[aria-modal="true"]')) return;
      cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function draw(analyser: AnalyserNode) {
    const canvas = canvasRef.current;
    // Canvas hali chizilmagan bo'lishi mumkin (React keyingi kadrda qo'yadi): keyingi kadrda yana urinamiz
    if (!canvas) {
      rafRef.current = requestAnimationFrame(() => draw(analyser));
      return;
    }
    const g = canvas.getContext("2d")!;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = 24;
    const loop = () => {
      analyser.getByteFrequencyData(data);
      const { width: w, height: h } = canvas;
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < bars; i++) {
        // Nutq chastotalari pastda: shu qismni kengroq olamiz
        const v = data[Math.floor((i / bars) * data.length * 0.5)] / 255;
        const bh = Math.max(3, v * h * 0.95);
        const x = (i / bars) * w;
        const grad = g.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, "#4d6bfe");
        grad.addColorStop(0.5, "#a78bfa");
        grad.addColorStop(1, "#e07a5f");
        g.fillStyle = grad;
        g.beginPath();
        g.roundRect(x + 1, (h - bh) / 2, w / bars - 3, bh, 3);
        g.fill();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  async function start() {
    if (startingRef.current || phase !== "idle") return;
    startingRef.current = true;
    cancelled.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      startingRef.current = false;
      if (aliveRef.current) onErrorRef.current(t(micErrorKey(e)));
      return;
    }
    startingRef.current = false;
    if (!aliveRef.current) {
      // Ruxsat kutilayotganda sahifadan chiqib ketildi: mikrofonni darhol bo'shatamiz
      stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    streamRef.current = stream;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);

    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      cleanup();
      if (cancelled.current || !chunks.length || !aliveRef.current) {
        if (aliveRef.current) setPhase("idle");
        return;
      }
      setPhase("transcribing");
      const ctrl = new AbortController();
      transcribeRef.current = ctrl;
      try {
        const audio = await blobToWavBase64(new Blob(chunks, { type: rec.mimeType }));
        if (ctrl.signal.aborted) return;
        const { text } = await apiFetch<{ text: string }>("/voice/transcribe", {
          method: "POST",
          body: JSON.stringify({ audio, mime: "audio/wav" }),
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted || !aliveRef.current) return;
        if (text) onTextRef.current(text);
        else onErrorRef.current(t("voice.noSpeech"));
      } catch (e) {
        if ((e as Error).name !== "AbortError" && aliveRef.current) onErrorRef.current((e as Error).message);
      } finally {
        if (transcribeRef.current === ctrl) transcribeRef.current = null;
        if (aliveRef.current) setPhase("idle");
      }
    };
    recRef.current = rec;
    rec.start();
    setPhase("recording");
    rafRef.current = requestAnimationFrame(() => draw(analyser));
  }

  function stop() {
    if (recRef.current?.state === "recording") recRef.current.stop();
  }

  function cancel() {
    cancelled.current = true;
    stop();
  }

  if (phase === "recording") {
    return (
      <div
        ref={widgetRef}
        className="msg-in flex min-w-0 max-w-[50%] shrink-0 items-center gap-1.5 rounded-md border border-violet-500/40 bg-neutral-950 px-2"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        {/* Telefonda to'lqin yashiriladi: matn maydoniga joy qolsin (taymer va tugmalar ko'rinib turadi) */}
        <canvas ref={canvasRef} width={80} height={32} className="hidden h-8 w-20 min-w-0 sm:block" />
        <span className="w-9 shrink-0 font-mono text-xs tabular-nums text-neutral-400">
          {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
        </span>
        <button onClick={cancel} aria-label={t("voice.cancel")} className="shrink-0 rounded p-1 text-neutral-400 hover:text-neutral-50">
          <X size={14} />
        </button>
        <button onClick={stop} aria-label={t("voice.finish")} className="shrink-0 rounded bg-red-600 p-1.5 text-white hover:bg-red-500">
          <Square size={12} />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      disabled={phase === "transcribing"}
      aria-label={t("voice.button")}
      title={t("voice.button")}
      className="shrink-0 rounded-md border border-neutral-700 px-3 text-neutral-300 transition hover:border-violet-500 hover:text-neutral-50 disabled:opacity-60"
    >
      {phase === "transcribing" ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
    </button>
  );
}
