"""Foydalanuvchi kiritgan manzillarni tekshirish (SSRF himoyasi).

Server foydalanuvchi bergan URL ga so'rov yuborganda, u ichki tizimlarga (baza, bulut metadata 169.254.169.254,
localhost xizmatlari) murojaat qilish uchun ishlatilmasligi kerak. Lokal modellar (Ollama) uchun bu cheklov
faqat ALLOW_LOCAL_PROVIDERS=true bo'lganda yechiladi.

Ikki bosqich:
  1) so'rovdan oldin (`check_url_async`) — tushunarli 400 xato uchun;
  2) ULANISH paytida (`http_client` -> `GuardedTransport`) — host shu yerda resolve qilinadi va tekshirilgan IP ga
     ulaniladi. Tekshiruvdan keyin DNS javobi ichki manzilga almashtirilsa ham (DNS rebinding) ulanilmaydi.
"""
import ipaddress
import socket
from urllib.parse import urlparse

import anyio
import httpcore
import httpx

from app.config import settings
from app.providers.base import ProviderError

BLOCKED = (
    "Lokal/ichki manzillarga ruxsat yo'q. Lokal model (Ollama, LM Studio) uchun serverni o'z kompyuteringizda "
    "ishga tushiring va ALLOW_LOCAL_PROVIDERS=true qiling."
)


class UnsafeURL(ValueError):
    pass


class BlockedAddress(ProviderError):
    """Ulanish paytida host ichki manzilga chiqdi: so'rov yuborilmaydi (xato foydalanuvchiga ko'rsatiladi)."""


def _internal(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Internetda ochiq bo'lmagan har qanday manzil (100.64.0.0/10 CGNAT, Alibaba metadata 100.100.100.200 ham)."""
    mapped = getattr(ip, "ipv4_mapped", None)  # ::ffff:127.0.0.1 kabi
    if mapped is not None and _internal(mapped):
        return True
    # is_global yangi diapazonlarni ham qamraydi; aniq tekshiruvlar qoladi (masalan NAT64 is_global=True, lekin is_reserved)
    return (not ip.is_global or ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            or ip.is_multicast or ip.is_unspecified)


def _any_internal(addresses: list[str]) -> bool:
    return any(_internal(ipaddress.ip_address(a)) for a in addresses)


def _parse(url: str) -> tuple[str, str, int]:
    """(tozalangan url, host, port): sxema, login/parol va port tekshiriladi (DNS so'rovisiz)."""
    p = urlparse(url.strip())
    if p.scheme not in ("http", "https") or not p.hostname:
        raise UnsafeURL("Manzil http:// yoki https:// bilan boshlanishi kerak.")
    if p.username or p.password:
        raise UnsafeURL("Manzilda login/parol bo'lmasligi kerak.")
    try:
        port = p.port or (443 if p.scheme == "https" else 80)
    except ValueError:  # noto'g'ri port
        raise UnsafeURL("Manzil noto'g'ri.")
    return url.strip().rstrip("/"), p.hostname, port


async def resolve_host(host: str, port: int) -> list[str]:
    """Hostning barcha IP manzillari. DNS so'rovi alohida oqimda bajariladi (event loop to'xtamaydi)."""
    try:
        infos = await anyio.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError):  # socket.gaierror ham OSError; noto'g'ri IDNA nom — UnicodeError
        raise UnsafeURL("Manzil topilmadi (DNS).")
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


async def check_url_async(url: str) -> str:
    """Manzilni tekshiradi va tozalangan ko'rinishini qaytaradi (xato bo'lsa UnsafeURL)."""
    clean, host, port = _parse(url)
    if settings.allow_local_providers:
        return clean
    if _any_internal(await resolve_host(host, port)):
        raise UnsafeURL(BLOCKED)
    return clean


class _GuardedBackend(httpcore.AsyncNetworkBackend):
    """httpcore tarmoq backendi: hostni o'zi resolve qiladi, ichki manzil bo'lsa ulanmaydi, aks holda tekshirilgan
    IP ga ulanadi. TLS SNI va Host sarlavhasi asl host nomi bilan qoladi (httpcore ularni URL dan oladi)."""

    def __init__(self, inner: httpcore.AsyncNetworkBackend | None = None):
        self._inner = inner or httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        try:
            with anyio.fail_after(timeout):
                addresses = await resolve_host(host, port)
        except TimeoutError:
            raise httpcore.ConnectTimeout(f"DNS: {host}")
        except UnsafeURL as exc:
            raise httpcore.ConnectError(str(exc))
        # Bitta manzil ham ichki bo'lsa rad etamiz (so'rovdan oldingi tekshiruv bilan bir xil qoida)
        if not addresses or _any_internal(addresses):
            raise BlockedAddress(BLOCKED)
        error: Exception | None = None
        for ip in addresses:
            try:
                return await self._inner.connect_tcp(ip, port, timeout=timeout, local_address=local_address,
                                                     socket_options=socket_options)
            except httpcore.ConnectError as exc:  # keyingi manzilni sinaymiz (masalan IPv6 ishlamasa)
                error = exc
        raise error

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise BlockedAddress(BLOCKED)

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class GuardedTransport(httpx.AsyncHTTPTransport):
    """Oddiy httpx transporti, faqat ulanish `_GuardedBackend` orqali."""

    def __init__(self, inner: httpcore.AsyncNetworkBackend | None = None, **kwargs):
        super().__init__(**kwargs)
        # httpx tarmoq backendini tanlash uchun ochiq parametr bermaydi. Kutubxona o'zgarsa jim o'tib ketmasin:
        # himoyani o'rnatib bo'lmasa so'rov umuman yuborilmaydi.
        pool = getattr(self, "_pool", None)
        if not isinstance(pool, httpcore.AsyncConnectionPool) or not hasattr(pool, "_network_backend"):
            raise RuntimeError("httpx/httpcore versiyasi mos emas: SSRF himoyasini o'rnatib bo'lmadi")
        pool._network_backend = _GuardedBackend(inner)


def http_client(timeout: httpx.Timeout) -> httpx.AsyncClient:
    """Foydalanuvchi bergan manzillar (custom provayderlar) uchun HTTP mijoz.

    ALLOW_LOCAL_PROVIDERS=false bo'lsa manzil ulanish paytida tekshiriladi; true bo'lsa oddiy mijoz (lokal modellar).
    """
    if settings.allow_local_providers:
        return httpx.AsyncClient(timeout=timeout)
    return httpx.AsyncClient(timeout=timeout, transport=GuardedTransport())
