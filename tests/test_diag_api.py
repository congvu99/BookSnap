async def test_ping_reports_the_forwarded_client_address(anon):
    r = await anon.get("/api/diag/ping", headers={"X-Forwarded-For": "203.0.113.7", "Via": "1.1 Caddy"})
    assert r.status_code == 200
    body = r.json()
    assert body["ip"] == "203.0.113.7"
    assert body["via"] == "1.1 Caddy"
    assert body["server_time"]
    assert r.headers["cache-control"] == "no-store"


async def test_ping_needs_no_session(anon):
    assert (await anon.get("/api/diag/ping")).status_code == 200
