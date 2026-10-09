"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { blobToWavBase64 } from "@/lib/wav";
import { useI18n } from "@/lib/i18n";

const MAX_SECONDS = 120;
type Phase = "idle" | "recording" | "transcribing";

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
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const cleanup = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioCtxRef.current = null;
  };
  useEffect(() => cleanup, []);

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

  // Esc — bekor qilish
  useEffect(() => {
    if (phase !== "recording") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function draw(analyser: AnalyserNode) {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    cancelled.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      onError(t("voice.denied"));
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
      if (cancelled.current || !chunks.length) {
        setPhase("idle");
        return;
      }
      setPhase("transcribing");
      try {
        const audio = await blobToWavBase64(new Blob(chunks, { type: rec.mimeType }));
        const { text } = await apiFetch<{ text: string }>("/voice/transcribe", {
          method: "POST",
          body: JSON.stringify({ audio, mime: "audio/wav" }),
        });
        if (text) onText(text);
        else onError(t("voice.noSpeech"));
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setPhase("idle");
      }
    };
    recRef.current = rec;
    rec.start();
    setPhase("recording");
    requestAnimationFrame(() => draw(analyser));
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
      <div className="msg-in flex items-center gap-2 rounded-md border border-violet-500/40 bg-neutral-950 px-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        <canvas ref={canvasRef} width={120} height={32} className="h-8 w-[120px]" />
        <span className="w-10 font-mono text-xs tabular-nums text-neutral-400">
          {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
        </span>
        <button onClick={cancel} aria-label={t("voice.cancel")} className="rounded p-1 text-neutral-400 hover:text-neutral-50">
          <X size={14} />
        </button>
        <button onClick={stop} aria-label={t("voice.finish")} className="rounded bg-red-600 p-1.5 hover:bg-red-500">
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
      className="rounded-md border border-neutral-700 px-3 text-neutral-300 transition hover:border-violet-500 hover:text-neutral-50 disabled:opacity-60"
    >
      {phase === "transcribing" ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
    </button>
  );
}
