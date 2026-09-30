import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import basemap.proxy
import pytest
import requests
from basemap.proxy import resilient_proxy

DATA = bytes(range(256)) * 4096  # 1 MiB


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    monkeypatch.setattr(basemap.proxy.time, "sleep", lambda _s: None)


@pytest.fixture
def flaky_upstream():
    """Serves DATA by range. Its first response is a 500, its second is cut off
    halfway through the body, and every response after that is fine."""
    calls = {"n": 0}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format, *args):
            pass

        def do_GET(self):
            calls["n"] += 1
            match = re.match(r"bytes=(\d+)-(\d+)", self.headers["Range"])
            assert match
            start, end = map(int, match.groups())
            if calls["n"] == 1:
                self.send_response(500)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            body = DATA[start : end + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(DATA)}")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("ETag", '"v1"')
            self.end_headers()
            if calls["n"] == 2:
                self.wfile.write(body[: len(body) // 2])
                self.close_connection = True
                return
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/planet.pmtiles", calls
    server.shutdown()


def test_proxy_retries_and_resumes(flaky_upstream):
    url, calls = flaky_upstream
    with resilient_proxy(url, len(DATA)) as local:
        resp = requests.get(local, headers={"Range": "bytes=1000-700000"}, timeout=30)
    assert resp.status_code == 206
    assert resp.headers["Content-Range"] == f"bytes 1000-700000/{len(DATA)}"
    assert resp.content == DATA[1000:700001]
    # The 500, the truncated body, and the resumed read of the rest.
    assert calls["n"] == 3


def test_proxy_requires_a_range(flaky_upstream):
    url, _ = flaky_upstream
    with resilient_proxy(url, len(DATA)) as local:
        assert requests.get(local, timeout=30).status_code == 416
