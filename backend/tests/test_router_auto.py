"""Auto rejim: vazifa turini aniqlash (uz/ru/en) va model tanlash tartibi (tarmoqsiz, bazasiz)."""
import pytest

from app.providers.router_auto import choose, classify

CODE = [
    "Menga python funksiya yozib ber",
    "Bu kodni tuzatib ber, ishlamayapti",
    "Funksiyani optimallashtir",
    "Dasturni ishga tushirolmayapman",
    "Saytimni tuzatib ber",
    "Navbar uchun logo va menyu bilan HTML sahifa yozib ber",
    "Saytimga logo qo‘yadigan HTML yoz",
    "React komponentiga logo rasmini qo‘sh",
    "Saytim uchun logo chizib ber",  # kod belgisi (sayt) rasm fe'lidan ustun
    "Create a logo in SVG",
    "Исправь ошибку в этой функции",
    "Исправь ошибку в коде",
    "Напиши функцию сортировки",
    "Сделай сайт-визитку для кафе",
    "Напиши программу на питоне",
    "Есть баг в приложении",
    "Write a function that reverses a string",
    "Fix this bug in my React component",
    "create a react component with an image gallery",
    "```js\nconsole.log(1)\n```",
    "Telegram bot yozib ber",
    "SQL so'rov yozib ber",
    "Landing page yarat",
    "veb-sayt uchun CSS yoz",
    "Mening kodimda xato bor",
    "main.py faylini o'qib ber",
    "Algoritmni tushuntirib ber",
    "o'zgaruvchi nima?",
    "dasturlashni qayerdan boshlay?",
]
IMAGE = [
    "kichik logo chizib ber",
    "rasmni chiz: tog'lar",
    "Mushuk rasmini chizib ber",
    "Tog'lar haqida chiroyli rasm yaratib ber",
    "Kompaniyam uchun logo yarat",
    "logotip tayyorlab ber kafe uchun",
    "Bir surat yaratib ber: dengiz bo'yi",
    "rasm qil: qishki o'rmon",
    "Yangi yil uchun poster yarat",
    "Draw a cat wearing a hat",
    "Generate an image of a sunset over the sea",
    "Create a picture of a dragon",
    "Make me a logo for my bakery",
    "paint a picture of autumn",
    "Нарисуй кота в космосе",
    "Нарисуйте дом",
    "Сгенерируй, пожалуйста, красивую картинку с горами",
    "Создай логотип для кофейни",
    "Изобрази закат над морем",
    # jadval/grafik so'zi bor, lekin chizilayotgan narsa boshqa (stol, uslub)
    "draw a cat sitting on a table",
    "Draw a dog under the table",
    "draw a picture of a graph",
    "mushukni stol ustida chizib ber, grafik uslubda",
    "grafik uslubda mushuk chizib ber",
    "Нарисуй кота, который сидит на столе",
]
GENERAL = [
    "salom, qalaysan?",
    "Kompaniyam uchun logo kerak, qanday maslahat berasan?",  # yolg'iz "logo" — rasm so'rovi emas
    "Can you help me draw conclusions from this data?",
    "Bu rasmda nima bor?",
    "Bu suratda kim bor?",
    "Rasmni tahlil qil",
    "Dasturxonga nima qo'yay?",  # "dasturxon" — dastur emas
    "Menga yangi planshet tanlashda yordam ber, qaysi biri yaxshi va arzon?",  # "planshet" — "plan" emas
    "Jadval chizib ber: oylar va daromad",
    "Draw a table comparing cats and dogs",
    # jadval/grafikning o'zi chiziladi — matn bilan javob
    "Sotuvlar grafigini chizib ber",
    "jadval ko'rinishida chizib ber",
    "Draw me a bar chart of monthly sales",
    "Нарисуй таблицу умножения",
    "нарисуй мне круговую диаграмму расходов",
    "Write a poem about drawing",
    "Chiziqli tenglama nima?",
    "Botir qayerda?",
    "Посоветуй ботинки на зиму",
    "Багаж сколько весит?",
    "Привет, как дела?",
    "Как приготовить плов?",
    "What is the capital of France?",
    "Rapid growth tips",
]
REASONING = [
    "Bu tenglamani isbotla va har bir qadamni batafsil tushuntir iltimos",
    "Biznesim uchun marketing strategiyasini ishlab chiqib ber, batafsil",
    "Qaysi variant foydaliroq ekanini hisoblab ber: kredit yoki ijara, 5 yil uchun",
    "Make a plan for launching my startup in three months please",
    "Докажи, что сумма углов треугольника равна 180 градусам",
    "Реши задачу: поезд вышел из пункта А в 9 утра",
]


@pytest.mark.parametrize("kind,text", [("code", t) for t in CODE] + [("image", t) for t in IMAGE]
                         + [("general", t) for t in GENERAL] + [("reasoning", t) for t in REASONING])
def test_classify(kind, text):
    assert classify(text) == kind


def test_attached_image_is_vision():
    assert classify("nima bu?", has_image=True) == "vision"
    assert classify("logo chizib ber", has_image=True) == "vision"


def _m(mid, source="builtin", platform=False, available=True, vision=False, tools=True):
    return {"id": mid, "label": mid, "source": source, "platform": platform, "available": available,
            "vision": vision, "tools": tools}


def test_own_keys_and_custom_before_platform():
    items = [_m("gemini-2.5-flash", platform=True, vision=True), _m("gemini-2.5-pro", platform=True, vision=True),
             _m("deepseek-chat"), _m("cp:1:llama-3.3-70b", source="custom")]
    # O'z Deepseek kaliti bor: oddiy savol platforma Gemini'ga emas, Deepseek'ka
    assert choose("general", items)["id"] == "deepseek-chat"
    # Faqat platforma + custom provayder: custom (limitsiz) tanlanadi
    only = [items[0], items[1], items[3]]
    assert choose("general", only)["id"] == "cp:1:llama-3.3-70b"
    # Platforma limiti tugagan (available=False) va boshqa hech narsa yo'q
    assert choose("general", [_m("gemini-2.5-flash", platform=True, available=False)]) is None
    # Faqat platforma: o'shani tanlaydi
    assert choose("code", items[:2])["id"] == "gemini-2.5-pro"


def test_custom_fallback_respects_tools_and_vision():
    items = [_m("gemini-2.5-flash", platform=True, available=False, vision=True),
             _m("cp:1:gemma", source="custom", tools=False), _m("cp:1:qwen-coder", source="custom"),
             _m("cp:1:llava", source="custom", vision=True, tools=False)]
    assert choose("code", items, need_tools=True)["id"] == "cp:1:qwen-coder"
    assert choose("vision", items, need_vision=True)["id"] == "cp:1:llava"
    assert choose("vision", [items[2]], need_vision=True) is None  # rasmni ko'ra oladigan model yo'q
    assert choose("vision", [items[2]])["id"] == "cp:1:qwen-coder"  # ekspert "dizayn": faqat afzallik
