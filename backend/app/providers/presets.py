"""Tayyor provayder shablonlari: foydalanuvchi faqat kalitni kiritadi."""

PRESETS = {
    "openrouter": {"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "needs_key": True, "local": False,
                   "key_url": "https://openrouter.ai/keys", "note": "300+ model bitta kalit bilan (Claude, GPT, Llama, Qwen, ...). :free modellar bepul."},
    "groq": {"name": "Groq", "base_url": "https://api.groq.com/openai/v1", "needs_key": True, "local": False,
             "key_url": "https://console.groq.com/keys", "note": "Juda tez, bepul darajasi bor. Ovozni matnga (Whisper) ham.", "stt_model": "whisper-large-v3-turbo"},
    "openai": {"name": "OpenAI", "base_url": "https://api.openai.com/v1", "needs_key": True, "local": False,
               "key_url": "https://platform.openai.com/api-keys", "note": "GPT modellar, Whisper.", "stt_model": "whisper-1"},
    "mistral": {"name": "Mistral", "base_url": "https://api.mistral.ai/v1", "needs_key": True, "local": False,
                "key_url": "https://console.mistral.ai/api-keys", "note": "Mistral va Codestral."},
    "xai": {"name": "xAI (Grok)", "base_url": "https://api.x.ai/v1", "needs_key": True, "local": False,
            "key_url": "https://console.x.ai", "note": "Grok modellar."},
    "together": {"name": "Together AI", "base_url": "https://api.together.xyz/v1", "needs_key": True, "local": False,
                 "key_url": "https://api.together.ai/settings/api-keys", "note": "Ochiq modellar (Llama, Qwen, DeepSeek)."},
    "ollama": {"name": "Ollama (lokal)", "base_url": "http://localhost:11434/v1", "needs_key": False, "local": True,
               "key_url": "https://ollama.com/download", "note": "Kompyuteringizdagi bepul modellar. Internet va kalit kerak emas."},
    "lmstudio": {"name": "LM Studio (lokal)", "base_url": "http://localhost:1234/v1", "needs_key": False, "local": True,
                 "key_url": "https://lmstudio.ai", "note": "Lokal modellar, qulay grafik ilova."},
    "custom": {"name": "Boshqa (OpenAI-mos)", "base_url": "", "needs_key": False, "local": False,
               "key_url": "", "note": "Istalgan OpenAI-mos manzil (vLLM, LocalAI, ...)."},
}
