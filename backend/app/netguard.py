"""Foydalanuvchi kiritgan manzillarni tekshirish (SSRF himoyasi).

Server foydalanuvchi bergan URL ga so'rov yuborganda, u ichki tizimlarga (baza, bulut metadata 169.254.169.254,
localhost xizmatlari) murojaat qilish uchun ishlatilmasligi kerak. Lokal modellar (Ollama) uchun bu cheklov
faqat ALLOW_LOCAL_PROVIDERS=true bo'lganda yechiladi.
"""
import ipaddress
import socket
from urllib.parse import urlparse

from app.config import settings


class UnsafeURL(ValueError):
    pass


def check_url(url: str) -> str:
    p = urlparse(url.strip())
    if p.scheme not in ("http", "https") or not p.hostname:
        raise UnsafeURL("Manzil http:// yoki https:// bilan boshlanishi kerak.")
    if p.username or p.password:
        raise UnsafeURL("Manzilda login/parol bo'lmasligi kerak.")
    if settings.allow_local_providers:
        return url.strip().rstrip("/")
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80))
    except socket.gaierror:
        raise UnsafeURL("Manzil topilmadi (DNS).")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise UnsafeURL(
                "Lokal/ichki manzillarga ruxsat yo'q. Lokal model (Ollama, LM Studio) uchun serverni o'z kompyuteringizda "
                "ishga tushiring va ALLOW_LOCAL_PROVIDERS=true qiling."
            )
    return url.strip().rstrip("/")
