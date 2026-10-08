"""Agent asboblari (provayderdan mustaqil JSON Schema).

Asboblar SERVERDA emas, foydalanuvchining kompyuterida (desktop ilova) bajariladi:
server faqat modelga ularni e'lon qiladi va model so'ragan chaqiruvlarni mijozga qaytaradi.
"""

TOOLS = [
    {
        "name": "list_dir",
        "description": "Papka ichidagi fayl va papkalar ro'yxati. Yo'l loyiha ildiziga nisbatan (masalan '.' yoki 'src').",
        "schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Nisbiy yo'l, ildiz uchun '.'"}},
            "required": ["path"],
        },
    },
    {
        "name": "read_file",
        "description": "Matnli faylni o'qiydi (katta fayllar qisqartiriladi).",
        "schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Faylni to'liq yozadi (yo'q bo'lsa yaratadi). Foydalanuvchi ruxsat berishi kerak.",
        "schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
    },
    {
        "name": "edit_file",
        "description": "Fayldagi aniq bir matn bo'lagini boshqasiga almashtiradi. old_text faylda aynan bir marta uchrashi kerak.",
        "schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_text": {"type": "string"},
                "new_text": {"type": "string"},
            },
            "required": ["path", "old_text", "new_text"],
        },
    },
    {
        "name": "search_files",
        "description": "Loyiha fayllari ichidan matn qidiradi (katta-kichik harf farqlanmaydi). Mos qatorlarni qaytaradi.",
        "schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "path": {"type": "string", "description": "Qaysi papkada qidirish (ixtiyoriy, standart '.')"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "run_command",
        "description": "Loyiha papkasida terminal buyrug'ini ishga tushiradi (masalan testlar). Foydalanuvchi ruxsat berishi kerak.",
        "schema": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
        },
    },
]

SYSTEM_PROMPT = """You are the coding agent inside OmniAI Workspace, working in a folder on the user's own computer.
The folder is named "{folder}". All paths are relative to that folder; never use absolute paths.

Work like a careful senior engineer:
- Explore before changing anything: list directories, read the relevant files, search for usages.
- Prefer edit_file for small changes; use write_file for new files or full rewrites.
- The user approves every write and command in a dialog. If a tool result says the user declined, do not retry the same action; explain or ask instead.
- Run tests or the build with run_command when it helps verify your change.
- Keep the user informed with short notes between steps, and finish with a brief summary of what you changed.
Reply in the language the user writes in (often Uzbek)."""
