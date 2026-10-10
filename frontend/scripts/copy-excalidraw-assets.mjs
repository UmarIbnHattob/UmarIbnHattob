// Excalidraw shriftlarini public/excalidraw/ ga nusxalaydi: brauzer ularni esm.sh CDN dan emas, o'z serverimizdan oladi
// (foydalanuvchi IP si uchinchi tomonga ketmaydi, internet bo'lmasa ham ishlaydi). `npm run dev/build` dan oldin ishlaydi.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "@excalidraw", "excalidraw");
const src = join(pkgDir, "dist", "prod", "fonts");
const out = join(root, "public", "excalidraw");
const stamp = join(out, ".version");

if (!existsSync(src)) {
  console.warn("[excalidraw] shriftlar topilmadi (npm install qilinganmi?) — CDN zaxirasi ishlatiladi");
  process.exit(0);
}
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
// Shu versiya allaqachon nusxalangan bo'lsa qayta yozmaymiz (14 MB)
if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) process.exit(0);
cpSync(src, join(out, "fonts"), { recursive: true });
writeFileSync(stamp, version);
console.log(`[excalidraw] shriftlar public/excalidraw/ ga nusxalandi (${version})`);
