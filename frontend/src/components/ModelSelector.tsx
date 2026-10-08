"use client";

import type { ModelInfo } from "@/lib/chatApi";

export default function ModelSelector({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 max-w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
