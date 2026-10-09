"""Auto rejim: vazifa turiga qarab eng mos modelni tanlaydi.

Qoida oddiy va tushunarli (foydalanuvchiga sababi ko'rsatiladi):
  rasm chizish -> Gemini rasm modeli; rasmni tushunish -> Claude/Gemini; kod -> Claude/Deepseek;
  murakkab mantiq -> Claude Opus/Deepseek Reasoner; oddiy savol -> tez va arzon model (Gemini Flash/Deepseek).
Faqat foydalanuvchida kaliti bor (yoki platforma kaliti) modellar orasidan tanlanadi.
"""
import re

KINDS = ("image", "vision", "code", "reasoning", "general")

_IMAGE = re.compile(
    r"\b(rasm(ini|ni)?\s*(chiz|yarat|qil)|surat\s*(chiz|yarat)|logo|logotip|illyustratsiya|draw|generate (an? )?(image|picture|logo)|"
    r"create (an? )?(image|picture|illustration)|нарисуй|сгенерируй (картинку|изображение)|картинк)",
    re.I,
)
_CODE = re.compile(
    r"(```|\b(kod|code|dastur|funksiya|function|class|bug|xato(ni)? tuzat|debug|python|javascript|typescript|react|html|css|sql|"
    r"api|backend|frontend|sayt|website|landing|script|skript|regex|algoritm|algorithm|компонент|код|функци|сайт|ошибк)\b)",
    re.I,
)
_REASON = re.compile(
    r"\b(isbotla|prove|matematika|math|tenglama|equation|mantiq|logic|strategiya|strategy|tahlil qil|analy[sz]e|"
    r"rejala|reja tuz|plan|qaror|decide|hisobla|calculate|reason|докажи|реши|стратеги|анализ)\w*",
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

REASONS = {
    "image": "rasm chizish", "vision": "rasmni tushunish", "code": "kod", "reasoning": "murakkab mantiq", "general": "umumiy savol",
}


def classify(text: str, has_image: bool = False) -> str:
    if has_image:
        return "vision"
    if _IMAGE.search(text):
        return "image"
    if _CODE.search(text):
        return "code"
    if _REASON.search(text) and len(text) > 40:
        return "reasoning"
    return "general"


def choose(kind: str, available: list[dict], need_tools: bool = False) -> dict | None:
    """Mavjud modellar ichidan tur uchun eng mosini qaytaradi (yoki None)."""
    pool = [m for m in available if m["available"] and (m["tools"] or not need_tools)]
    if kind == "vision":
        pool = [m for m in pool if m["vision"]] or pool
    by_id = {m["id"]: m for m in pool}
    for mid in PREFERENCES.get("code" if kind == "image" else kind, PREFERENCES["general"]):
        if mid in by_id:
            return by_id[mid]
    custom = [m for m in pool if m["source"] == "custom"]
    hint = _CUSTOM_HINT.get(kind)
    if hint:
        for m in custom:
            if hint.search(m["id"]):
                return m
    return custom[0] if custom else (pool[0] if pool else None)
