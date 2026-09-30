"""A local HTTP proxy that makes range reads of one remote file resilient.

``pmtiles extract`` reads the planet build in ~130 large range requests
(hundreds of MB each) and has no retry: one failed request fails the whole
extract, and it can't resume. build.protomaps.com (Cloudflare) fails often
enough, with 500s, 524 timeouts and HTTP/2 stream resets, that a plain
extract rarely finishes. So the extract reads through this proxy instead.
It forwards each range request upstream. When an upstream response fails,
before or during the body, it retries from the first byte not yet sent
downstream, so ``pmtiles`` only sees one slow but complete response.
"""

from __future__ import annotations

import re
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

RANGE_RE = re.compile(r"bytes=(\d+)-(\d*)$")
# Small, so a slow stream still yields often enough for the stall check.
CHUNK = 64 << 10
# A stream that delivers less than MIN_BYTES in STALL_WINDOW seconds is
# dropped and resumed on a fresh connection. Upstream sometimes keeps
# sending just enough bytes (tens of kB/s) that a read timeout never fires,
# which left a 21GB extract at 98% with an hour to go.
STALL_WINDOW = 30.0
MIN_BYTES = 1 << 20


class UpstreamError(Exception):
    pass


def _make_handler(upstream: str, size: int, attempts: int):
    session = requests.Session()
    # One ETag for the whole run: every resumed read must come from the same
    # build, not a re-upload under the same name.
    etag: dict[str, str | None] = {"value": None}
    etag_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format, *args):
            pass

        def _open(self, start: int, end: int) -> requests.Response:
            """An upstream 206 for bytes start..end, retried with backoff."""
            last: Exception | None = None
            for attempt in range(attempts):
                if attempt:
                    time.sleep(min(60, 2**attempt))
                try:
                    resp = session.get(
                        upstream,
                        headers={"Range": f"bytes={start}-{end}"},
                        stream=True,
                        timeout=(30, 120),
                    )
                    if resp.status_code != 206:
                        resp.close()
                        raise UpstreamError(f"HTTP {resp.status_code}")
                    with etag_lock:
                        got = resp.headers.get("ETag")
                        if etag["value"] is None:
                            etag["value"] = got
                        elif got and got != etag["value"]:
                            resp.close()
                            raise RuntimeError(f"{upstream} changed mid-extract (ETag {got})")
                    return resp
                except (requests.RequestException, UpstreamError) as e:
                    last = e
                    print(f"proxy: bytes {start}-{end} attempt {attempt + 1} failed: {e}")
            raise UpstreamError(f"bytes {start}-{end}: {attempts} attempts failed ({last})")

        def do_GET(self):
            match = RANGE_RE.match(self.headers.get("Range", ""))
            if not match:
                self.send_error(416, "range requests only")
                return
            start = int(match.group(1))
            end = min(int(match.group(2)) if match.group(2) else size - 1, size - 1)
            try:
                resp = self._open(start, end)
            except UpstreamError as e:
                self.send_error(502, str(e))
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Content-Type", "application/octet-stream")
            if etag["value"]:
                self.send_header("ETag", etag["value"])
            self.end_headers()

            offset = start
            while offset <= end:
                try:
                    window_start, window_bytes = time.monotonic(), 0
                    for chunk in resp.iter_content(CHUNK):
                        self.wfile.write(chunk)
                        offset += len(chunk)
                        window_bytes += len(chunk)
                        if time.monotonic() - window_start >= STALL_WINDOW:
                            if window_bytes < MIN_BYTES and offset <= end:
                                raise UpstreamError(
                                    f"stalled ({window_bytes} B in {STALL_WINDOW:.0f}s)"
                                )
                            window_start, window_bytes = time.monotonic(), 0
                    if offset <= end:
                        raise UpstreamError("upstream body ended early")
                except (requests.RequestException, UpstreamError) as e:
                    print(f"proxy: resuming at byte {offset} of {start}-{end} after: {e}")
                    resp.close()
                    # Headers are already sent: if the retries run out, dropping
                    # the connection is the only failure pmtiles can see.
                    resp = self._open(offset, end)
            resp.close()

    return Handler


@contextmanager
def resilient_proxy(upstream: str, size: int, attempts: int = 8) -> Iterator[str]:
    """Serve ``upstream`` (``size`` bytes) on localhost for the duration of the
    ``with`` block, yielding the local URL to read it from."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(upstream, size, attempts))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        name = upstream.rsplit("/", 1)[-1]
        yield f"http://127.0.0.1:{server.server_address[1]}/{name}"
    finally:
        server.shutdown()
        server.server_close()
