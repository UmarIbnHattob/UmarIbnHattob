"""SSRF himoyasi: DNS so'rovi event loop'dan tashqarida va ulanish paytidagi tekshiruv (DNS rebinding)."""
import json
import threading

import httpcore
import httpx
import pytest

from app import netguard
from app.config import settings
from app.providers import openai_compat
from app.providers.base import ProviderError

PUBLIC, METADATA = "93.184.216.34", "169.254.169.254"


class FakeStream(httpcore.AsyncNetworkStream):
    """Tarmoqsiz oqim: yuborilgan baytlarni yozib oladi va tayyor HTTP javob qaytaradi."""

    def __init__(self, log: dict):
        self.log, self.reply = log, b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"data\":[]}"

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.log["sni"] = server_hostname
        return self

    async def write(self, buffer, timeout=None):
        self.log["sent"] = self.log.get("sent", b"") + buffer

    async def read(self, max_bytes, timeout=None):
        data, self.reply = self.reply[:max_bytes], self.reply[max_bytes:]
        return data

    async def aclose(self):
        pass

    def get_extra_info(self, info):
        return None


class FakeBackend(httpcore.AsyncNetworkBackend):
    def __init__(self):
        self.log: dict = {"connects": []}

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.log["connects"].append((host, port))
        return FakeStream(self.log)

    async def sleep(self, seconds):
        pass


def fake_dns(monkeypatch, answers: list[list[str]]):
    """resolve_host navbat bilan shu javoblarni qaytaradi (oxirgisi takrorlanadi)."""
    calls = []

    async def resolve(host, port):
        calls.append(host)
        return answers[min(len(calls), len(answers)) - 1]
    monkeypatch.setattr(netguard, "resolve_host", resolve)
    return calls


@pytest.mark.anyio
async def test_dns_lookup_runs_off_the_event_loop(monkeypatch):
    import socket
    monkeypatch.setattr(settings, "allow_local_providers", False)
    threads = []

    def fake_getaddrinfo(host, port, *a, **k):
        threads.append(threading.get_ident())
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC, port))]
    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    assert await netguard.check_url_async(" https://api.example.com/v1/ ") == "https://api.example.com/v1"
    assert threads and threads[0] != threading.get_ident()  # alohida oqimda, loop to'xtamadi
    with pytest.raises(netguard.UnsafeURL):
        await netguard.check_url_async("https://api.example.com:99999/v1")


@pytest.mark.anyio
async def test_connects_to_validated_ip_keeping_host_and_sni(monkeypatch):
    calls = fake_dns(monkeypatch, [[PUBLIC]])
    backend = FakeBackend()
    async with httpx.AsyncClient(transport=netguard.GuardedTransport(inner=backend)) as client:
        r = await client.get("https://api.example.com/v1/models")
    assert r.status_code == 200 and r.json() == {"data": []}
    assert calls == ["api.example.com"]
    assert backend.log["connects"] == [(PUBLIC, 443)]  # tekshirilgan IP ga ulandi
    assert backend.log["sni"] == "api.example.com"  # TLS SNI — asl host nomi
    assert b"Host: api.example.com\r\n" in backend.log["sent"]


@pytest.mark.anyio
@pytest.mark.parametrize("answer", [[METADATA], [PUBLIC, "10.0.0.5"], ["::ffff:127.0.0.1"], []])
async def test_internal_address_blocked_at_connect_time(monkeypatch, answer):
    fake_dns(monkeypatch, [answer])
    backend = FakeBackend()
    async with httpx.AsyncClient(transport=netguard.GuardedTransport(inner=backend)) as client:
        with pytest.raises(netguard.BlockedAddress):
            await client.get("http://api.example.com/v1/models")
    assert backend.log["connects"] == []  # ichki manzilga umuman ulanilmadi


@pytest.mark.anyio
async def test_custom_provider_calls_use_guard_only_without_allow_local(monkeypatch):
    monkeypatch.setattr(settings, "allow_local_providers", True)
    async with netguard.http_client(httpx.Timeout(5)) as c:
        assert not isinstance(c._transport, netguard.GuardedTransport)  # lokal modellar: oddiy mijoz
    monkeypatch.setattr(settings, "allow_local_providers", False)
    async with netguard.http_client(httpx.Timeout(5)) as c:
        assert isinstance(c._transport, netguard.GuardedTransport)
    async with openai_compat._client("https://custom.example.com/v1", httpx.Timeout(5)) as c:
        assert isinstance(c._transport, netguard.GuardedTransport)
    async with openai_compat._client(openai_compat.DEEPSEEK_BASE, httpx.Timeout(5)) as c:
        assert not isinstance(c._transport, netguard.GuardedTransport)  # o'rnatilgan, o'zgarmas manzil

    # DNS rebinding: openai_compat ning barcha chaqiruvlari ulanish paytida to'xtatiladi (tarmoqqa chiqmasdan)
    fake_dns(monkeypatch, [[METADATA]])
    base = "https://rebind.example.com/v1"
    calls = [
        openai_compat.list_models(base, "k"),
        openai_compat.transcribe(base, "k", "whisper-1", b"RIFF"),
        openai_compat.step(base, "k", "m", "sys", [{"role": "user", "content": "x"}], []),
        openai_compat.complete(base, "k", "m", None, "salom"),
    ]
    for coro in calls:
        with pytest.raises(ProviderError, match="ichki"):
            await coro


@pytest.mark.anyio
async def test_guarded_client_ignores_proxy_env(monkeypatch):
    """HTTPS_PROXY bo'lsa ham himoyalangan mijoz proksi orqali ulanmaydi (aks holda manzilni proksi resolve qilardi).
    httpx o'zi transport berilganda muhit proksilarini e'tiborsiz qoldiradi; test kutubxona o'zgarsa ushlaydi."""
    monkeypatch.setattr(settings, "allow_local_providers", False)
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example.com:3128")
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.example.com:3128")
    async with netguard.http_client(httpx.Timeout(5)) as c:
        assert all(t is None for t in c._mounts.values())  # proksi transporti o'rnatilmagan
        assert isinstance(c._transport_for_url(httpx.URL("https://api.example.com/v1")), netguard.GuardedTransport)


def test_dns_rebinding_after_request_time_check_is_blocked(client, monkeypatch):
    """So'rovdan oldingi tekshiruv tashqi manzilni ko'radi, ulanish paytida esa DNS ichki manzil qaytaradi."""
    monkeypatch.setattr(settings, "allow_local_providers", False)

    async def fake_get(self, url, **kw):
        return httpx.Response(200, json={"data": [{"id": "llama-3.3-70b"}]}, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    fake_dns(monkeypatch, [[PUBLIC]])
    p = client.post("/api/providers", json={"kind": "custom", "base_url": "https://rebind.example.com/v1"})
    assert p.status_code == 201, p.text
    calls = fake_dns(monkeypatch, [[PUBLIC], [METADATA]])  # 1) resolve() tekshiruvi, 2) ulanish
    url = f"/api/conversations/{client.post('/api/conversations').json()['id']}/messages"
    r = client.post(url, json={"content": "salom", "model": f"cp:{p.json()['id']}:llama-3.3-70b"})
    ev = [json.loads(x[5:]) for x in r.text.strip().split("\n\n") if x.startswith("data:")]
    assert ev[-1]["type"] == "error" and "ichki" in ev[-1]["message"] and ev[-1]["user_message_removed"] is True
    assert calls == ["rebind.example.com", "rebind.example.com"]
