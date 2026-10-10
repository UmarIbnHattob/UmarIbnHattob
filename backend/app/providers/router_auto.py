"""Auto rejim: vazifa turiga qarab eng mos modelni tanlaydi.

Qoida oddiy va tushunarli (foydalanuvchiga sababi ko'rsatiladi):
  rasm chizish -> Gemini rasm modeli; rasmni tushunish -> Claude/Gemini; kod -> Claude/Deepseek;
  murakkab mantiq -> Claude Opus/Deepseek Reasoner; oddiy savol -> tez va arzon model (Gemini Flash/Deepseek).
Faqat foydalanuvchida kaliti bor (yoki platforma kaliti) modellar orasidan tanlanadi; foydalanuvchining o'z
kalitlari va provayderlari oylik limitli platforma kalitidan oldin.
"""
import re

KINDS = ("image", "vision", "code", "reasoning", "general")

# O'zbek/rus so'zlari qo'shimcha oladi (kodni, funksiyani, функцию, ошибку): o'zakdan keyin \w* qo'yiladi.
# Inglizcha qisqa atamalar esa aniq so'z chegarasi bilan (masalan "api" "rapid" ichida topilmasin).
_CODE = re.compile(
    r"```|c\+\+|c#|\.(?:py|js|ts|tsx|jsx|html|css|json|sql)\b"
    r"|\b(?:code|coding|coder|function|functions|class|bug|bugs|debug\w*|python|javascript|typescript|jsx|tsx|"
    r"react|vue|angular|svelte|next\.?js|node\.?js|html|css|scss|tailwind|svg|sql|api|apis|backend|frontend|"
    r"full-?stack|website|webpage|web\s+page|landing(?:\s+page)?|script|scripts|regex|algorithm\w*|"
    r"program(?:s|ming|mer)?|compile\w*|refactor\w*|json|yaml|java|kotlin|golang|php|laravel|django|flask|"
    r"fastapi|docker\w*|git|github|endpoint|components?|stack\s*trace|traceback|syntax\s+error|bash)\b"
    # o'zbekcha o'zaklar ("dasturxon" — dasturxon, kod emas)
    r"|\b(?:kod|dastur(?!xon)|funksiy|funktsiy|skript|sayt|algoritm|komponent|veb|o['‘’ʻʼ`]?zgaruvchi)\w*"
    r"|\bbot(?:i|ni|ga|lar\w*|im\w*)?\b"
    # ruscha o'zaklar
    r"|\b(?:код|программ|функци|ошибк|сайт|компонент|скрипт|алгоритм|верстк|отлад|питон|джаваскрипт|фронтенд|"
    r"бэкенд|бекенд)\w*|\bбаг(?:и|а|ов)?\b|\bбот(?:а|у|ом|ы|ов)?\b",
    re.I,
)

# Rasm chizish: aniq "chiz/draw/нарисуй" fe'li yoki "rasm/logo/картинка" + "yarat/generate/создай" birga kelsa.
# Yolg'iz "logo" yoki "rasm" so'zi (masalan "saytga logo qo'y", "bu rasmda nima bor") rasm so'rovi emas.
_DRAW = (
    r"\bchiz(?!iq|g\W?ich|ma(?!q))\w*"  # chiz, chizib ber, chizgin (chiziq, chizg'ich, chizma emas)
    r"|\bdraw\b(?!\s+(?:up|on|from|out|in|near|closer|back|attention|conclusions?|comparisons?|parallels?|"
    r"inspiration|lessons?|a\s+conclusion|a\s+line|the\s+line)\b)"
    r"|\bнарис\w*|\bизобрази\w*"
)
_NOUN = (
    r"\b(?:rasm|surat|logo|logotip|illyustratsiya|ikonka|image|images|picture|pictures|photo|illustration|icon|"
    r"wallpaper|poster|banner|avatar|drawing|sketch|картинк|изображени|рисун|логотип|иллюстрац|фото|постер|"
    r"баннер|аватар|обо[ия])\w*"
)
_VERB = (
    r"\b(?:yarat|tayyorla|chiqar|generatsiya|generate|create|make|design|render|paint|sketch|illustrate|"
    r"сгенерир|генерир|созда|сделай|придума)\w*"
)
_IMAGE = re.compile(
    rf"{_DRAW}|(?:{_NOUN})\W+(?:\w+\W+){{0,3}}?(?:{_VERB})|(?:{_VERB})\W+(?:\w+\W+){{0,3}}?(?:{_NOUN})"
    r"|\brasm(?:ini|ni)?\s+qil",
    re.I,
)
# Jadval/grafik "chizish" — matn (markdown/kod) bilan javob beriladi, rasm modeli emas
_NOT_IMAGE = re.compile(r"\b(?:jadval|grafik|diagramm|chart|graph|plot|table|таблиц|график|диаграмм|схем)\w*", re.I)

_REASON = re.compile(
    r"\b(?:isbotla|matematik|tenglama|mantiq|strategiya|tahlil\s+qil|rejala|reja\s+tuz|qaror|hisobla|"
    r"докаж|реши|стратеги|анализ|вычисл|рассчита)\w*"
    # "plan" — "planshet" emas
    r"|\b(?:prove|proof|math|maths|mathematics|mathematical|equations?|logic|logical|strategy|strategies|"
    r"analy[sz]e|analysis|plan|plans|planning|decide|decision|calculate|calculation|reason|reasoning|theorem)\b",
    re.I,
)

# Har bir tur uchun afzal ko'rilgan o'rnatilgan modellar (tartib muhim)
PREFERENCES = {
    "vision": ["claude-sonnet-5-5", "gemini-2.5-pro", "gemini-2.5-flash", "claude-opus-5-5"],
    "code": ["claude-sonnet-5-5", "deepseek-chat", "gemini-2.5-pro", "claude-opus-5-5"],
    "reasoning": ["claude-opus-5-5", "deepseek-reasoner", "gemini-2.5-pro", "claude-sonnet-5-5"],
    "general": ["gemini-2.5-flash", "deepseek-chat", "claude-sonnet-5-5", "gemini-2.5-pro"],
}
_CUSTOM_HINT = {"code": re.compile(r"cod|coder|qwen|deepseek|devstral|starcoder", re.I),
                "reasoning": re.compile(r"r1|reason|think|o\d|qwq", re.I)}

# Eski mijozlar uchun o'zbekcha matn; yangi UI `kind` ni o'zi tarjima qiladi
REASONS = {
    "image": "rasm chizish", "vision": "rasmni tushunish", "code": "kod", "reasoning": "murakkab mantiq", "general": "umumiy savol",
}


def classify(text: str, has_image: bool = False) -> str:
    if has_image:
        return "vision"
    code = bool(_CODE.search(text))
    # Kod belgilari (html, sayt, react, kod...) bo'lsa — rasm emas, kod so'rovi ("saytga logo qo'yadigan HTML")
    if not code and _IMAGE.search(text) and not _NOT_IMAGE.search(text):
        return "image"
    if code:
        return "code"
    if _REASON.search(text) and len(text) > 40:
        return "reasoning"
    return "general"


def _best(pool: list[dict], prefs: list[str], hint: re.Pattern | None) -> dict | None:
    by_id = {m["id"]: m for m in pool}
    for mid in prefs:
        if mid in by_id:
            return by_id[mid]
    custom = [m for m in pool if m["source"] == "custom"]
    if hint:
        for m in custom:
            if hint.search(m["id"]):
                return m
    return custom[0] if custom else (pool[0] if pool else None)


def choose(kind: str, available: list[dict], need_tools: bool = False, need_vision: bool = False) -> dict | None:
    """Mavjud modellar ichidan tur uchun eng mosini qaytaradi (yoki None).

    Avval foydalanuvchining o'z kalitlari va provayderlari (limitsiz), keyin oylik limitli platforma kaliti.
    need_tools: agent uchun asbob chaqira oladigan model; need_vision: rasm ilova qilingan (rasmni ko'ra olishi shart).
    """
    pool = [m for m in available if m["available"] and (m["tools"] or not need_tools)]
    if need_vision:
        pool = [m for m in pool if m["vision"]]
    elif kind == "vision":
        pool = [m for m in pool if m["vision"]] or pool
    prefs = PREFERENCES.get("code" if kind == "image" else kind, PREFERENCES["general"])
    hint = _CUSTOM_HINT.get(kind)
    own = [m for m in pool if not m.get("platform")]
    shared = [m for m in pool if m.get("platform")]
    return _best(own, prefs, hint) or _best(shared, prefs, hint)
