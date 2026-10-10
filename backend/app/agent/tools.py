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
        "name": "update_plan",
        "description": "Show the user a live task checklist. Call at the start of multi-step work and whenever a step's status changes. Send the FULL list each time.",
        "schema": {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "status": {"type": "string", "enum": ["pending", "in_progress", "done"]},
                        },
                        "required": ["title", "status"],
                    },
                }
            },
            "required": ["steps"],
        },
    },
    {
        "name": "generate_image",
        "description": "Generate an image (hero banner, illustration, icon, background) with an image model and save it as a PNG file in the project. Use for website visuals instead of external image URLs.",
        "schema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Detailed visual description in English: subject, style, colors, composition."},
                "path": {"type": "string", "description": "Relative path to save, e.g. assets/hero.png"},
            },
            "required": ["prompt", "path"],
        },
    },
    {
        "name": "ask_expert",
        "description": "Ask a different AI model for expert advice and get its answer as text. expertise: 'design' (UI/UX, colors, layout, copywriting), 'code' (implementation, code review), 'reasoning' (architecture, tricky logic).",
        "schema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Self-contained question with all needed context (the expert cannot see the files)."},
                "expertise": {"type": "string", "enum": ["design", "code", "reasoning"]},
            },
            "required": ["question", "expertise"],
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
- For multi-step work, call update_plan first and keep it updated.
- You can use generate_image for visuals and ask_expert to consult another model (e.g. design advice, a second opinion on code).

When the user asks to build a website or app, follow this workflow (adapt as needed):
1. update_plan: requirements → structure/skeleton → design → visuals → code → preview → publish.
2. Clarify only if something essential is missing; otherwise make sensible choices and state them.
3. Create the file skeleton (index.html, styles.css, script.js, assets/).
4. ask_expert(design): palette, typography, layout, section copy. Then generate_image for the hero and key visuals into assets/.
5. Write clean, responsive, accessible code. Prefer a single self-contained page unless the user asked for more.
6. Tell the user to press "Open" on the HTML file card to preview it.
7. Publishing: explain options (Netlify Drop, Vercel, GitHub Pages). Only run a deploy command (e.g. `npx vercel --prod`) if the user agrees; it needs their account.
Reply in the language the user writes in (often Uzbek)."""
