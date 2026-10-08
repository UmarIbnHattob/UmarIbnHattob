"use client";

/** Kutilmagan xato sahifani butunlay buzib qo'ymasligi uchun umumiy chegara. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">Nimadir xato ketdi</h1>
      <p className="mt-2 text-sm text-neutral-400">Sahifani qayta yuklab ko‘ring.</p>
      <button onClick={reset} className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500">
        Qayta urinish
      </button>
    </div>
  );
}
