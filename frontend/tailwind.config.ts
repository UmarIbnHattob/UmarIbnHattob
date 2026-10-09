import type { Config } from "tailwindcss";

// Kulrang shkala CSS o'zgaruvchilarida: yorug' mavzuda u teskari aylanadi (globals.css),
// shuning uchun komponentlardagi bg-neutral-900 / text-neutral-100 ikkala mavzuda ham to'g'ri ishlaydi.
const neutral = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, `rgb(var(--n-${n}) / <alpha-value>)`]),
);

const config: Config = {
  content: ["./src/pages/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}", "./src/app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: { neutral },
    },
  },
  plugins: [],
};
export default config;
