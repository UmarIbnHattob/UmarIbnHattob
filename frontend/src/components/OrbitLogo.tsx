import { PROVIDER_COLORS } from "@/lib/providers";

/**
 * "Omni" logotipi: markaz (yadro) atrofida uchta model-sayyora turli tezlikda aylanadi.
 * `focus` berilsa, faqat o'sha provayder sayyorasi yorqin bo'ladi (model o'ylayotganda).
 */
export default function OrbitLogo({ size = 40, focus }: { size?: number; focus?: string | null }) {
  const rings = [
    { p: "anthropic", inset: 0.06, dur: "3.2s" },
    { p: "deepseek", inset: 0.2, dur: "2.3s", reverse: true },
    { p: "gemini", inset: 0.33, dur: "1.7s" },
  ];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      {rings.map((r) => (
        <div
          key={r.p}
          className="orbit-ring"
          style={{ inset: size * r.inset, opacity: focus && focus !== r.p ? 0.25 : 1 }}
        >
          <div
            className="orbit"
            style={{ animationDuration: r.dur, animationDirection: r.reverse ? "reverse" : "normal" }}
          >
            <i style={{ ["--c" as string]: PROVIDER_COLORS[r.p], width: Math.max(3, size / 9), height: Math.max(3, size / 9) }} />
          </div>
        </div>
      ))}
      <div className="orbit-core" style={{ inset: size * 0.42 }} />
    </div>
  );
}
