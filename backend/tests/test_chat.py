import base64
import json

from app.providers.base import merge_history, trim_history
from tests.conftest import make_client

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 20).decode()


def events(r):
    return [json.loads(x[5:]) for x in r.text.strip().split("\n\n") if x.startswith("data:")]


def new_conv(c):
    return c.post("/api/conversations").json()["id"]


def test_missing_key_rejected_before_stream(client, fake_llm):
    cid = new_conv(client)
    r = client.post(f"/api/conversations/{cid}/messages", json={"content": "salom", "model": "claude-sonnet-5-5"})
    assert r.status_code == 400 and "Settings" in r.json()["detail"]
    assert client.get(f"/api/conversations/{cid}/messages").json() == []  # xabar saqlanmagan


def test_stream_and_model_switch_keeps_context(client, fake_llm):
    client.put("/api/keys/anthropic", json={"key": "key-anthropic-1234"})
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    cid = new_conv(client)
    url = f"/api/conversations/{cid}/messages"
    r = client.post(url, json={"content": "salom", "model": "claude-sonnet-5-5"})
    assert [e["type"] for e in events(r)] == ["delta", "delta", "done"]
    client.post(url, json={"content": "davom et", "model": "deepseek-chat"})
    last = fake_llm[-1]
    assert last["key"] == "key-deepseek-1234"
    assert [m["role"] for m in last["messages"]] == ["user", "assistant", "user"]
    assert [(m["role"], m["model"]) for m in client.get(url).json()] == [
        ("user", None), ("assistant", "claude-sonnet-5-5"), ("user", None), ("assistant", "deepseek-chat")
    ]
    assert client.get("/api/conversations").json()[0]["title"] == "salom"


def test_canvas_image_rules(client, fake_llm):
    client.put("/api/keys/anthropic", json={"key": "key-anthropic-1234"})
    client.put("/api/keys/deepseek", json={"key": "key-deepseek-1234"})
    url = f"/api/conversations/{new_conv(client)}/messages"
    assert client.post(url, json={"content": "x", "model": "deepseek-chat", "image": PNG}).status_code == 400
    assert client.post(url, json={"content": "x", "model": "claude-sonnet-5-5", "image": "@@@"}).status_code == 400
    bad = base64.b64encode(b"not a png").decode()
    assert client.post(url, json={"content": "x", "model": "claude-sonnet-5-5", "image": bad}).status_code == 400
    assert client.post(url, json={"content": "bu nima", "model": "claude-sonnet-5-5", "image": PNG}).status_code == 200
    assert fake_llm[-1]["messages"][-1]["image"] == PNG
    client.post(url, json={"content": "yana", "model": "claude-sonnet-5-5"})
    assert not any(m.get("image") for m in fake_llm[-1]["messages"])  # eski rasm qayta yuborilmaydi
    assert [m["has_canvas"] for m in client.get(url).json() if m["role"] == "user"] == [True, False]


def test_users_are_isolated(client, fake_llm):
    client.put("/api/keys/anthropic", json={"key": "key-anthropic-1234"})
    cid = new_conv(client)
    other = make_client("vali@example.com")
    assert other.get(f"/api/conversations/{cid}/messages").status_code == 404
    assert other.delete(f"/api/conversations/{cid}").status_code == 404
    assert not [k for k in other.get("/api/keys").json() if k["configured"]]


def test_merge_and_trim_history():
    merged = merge_history([
        {"role": "user", "content": "a"}, {"role": "user", "content": "b", "image": "IMG"},
        {"role": "assistant", "content": "c"},
    ])
    assert merged == [{"role": "user", "content": "a\n\nb", "image": "IMG"}, {"role": "assistant", "content": "c"}]
    long = [{"role": r, "content": "x" * 50} for r in ["user", "assistant"] * 5] + [{"role": "user", "content": "oxirgi"}]
    trimmed = trim_history(long, max_chars=180)
    assert trimmed[-1]["content"] == "oxirgi" and trimmed[0]["role"] == "user" and len(trimmed) < len(long)
