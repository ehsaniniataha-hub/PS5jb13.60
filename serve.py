import http.server
import ipaddress
import json
import re
import socket
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = 8000
ROOT = Path(__file__).resolve().parent
LOGFILE = ROOT / "ps5_exploit_log.txt"
ELFLDR_PORT = 9021
PAYLOADS_DIR = ROOT / "payloads"
PAYLOAD_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+\.(elf|bin)$")

_log_fp = None


def logfile():
    global _log_fp
    if _log_fp is None:
        _log_fp = open(LOGFILE, "a", encoding="utf-8")
    return _log_fp


def emit(line):
    print(line, flush=True)
    try:
        logfile().write(line + "\n")
        logfile().flush()
    except Exception:
        pass


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        path = str(args[0]) if args else ""
        if not path.startswith("/__"):
            emit(f"[{time.strftime('%H:%M:%S')}] REQ {path}")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if self.path.startswith("/__hb") or self.path.startswith("/__log"):
            self._ps5_ping()
            return
        if path in ("/api/elfldr", "/api/elfldr/"):
            self._api_elfldr()
            return
        m = re.match(r"^/api/payload/([^/]+)$", path)
        if m:
            self._api_payload(m.group(1))
            return
        super().do_GET()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _console_ip(self):
        return self.client_address[0]

    def _api_elfldr(self):
        ip = self._console_ip()
        try:
            with socket.create_connection((ip, ELFLDR_PORT), timeout=1.5):
                up = True
        except OSError:
            up = False
        self._json(200, {"up": up})

    def _api_payload(self, name):
        ip = self._console_ip()
        if not PAYLOAD_NAME_RE.match(name):
            return self._json(400, {"ok": False, "error": "bad payload name"})
        file = (PAYLOADS_DIR / name).resolve()
        if PAYLOADS_DIR.resolve() not in file.parents:
            return self._json(400, {"ok": False, "error": "bad payload path"})
        try:
            data = file.read_bytes()
        except OSError:
            return self._json(404, {"ok": False, "error": "payload not found: " + name})
        try:
            with socket.create_connection((ip, ELFLDR_PORT), timeout=15) as sock:
                sock.sendall(data)
        except OSError as e:
            emit(f"[{time.strftime('%H:%M:%S')}] PAYLOAD {name} -> {ip} FAILED: {e}")
            return self._json(502, {"ok": False, "error": f"connect {ip}:{ELFLDR_PORT} - {e}"})
        emit(f"[{time.strftime('%H:%M:%S')}] PAYLOAD {name} -> {ip} {len(data)} bytes")
        self._json(200, {"ok": True, "bytes": len(data), "name": name, "to": f"{ip}:{ELFLDR_PORT}"})

    def do_POST(self):
        if self.path.startswith("/__hb") or self.path.startswith("/__log"):
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length:
                self.rfile.read(length)
            self._ps5_ping()
            return
        self.send_error(404)

    def _ps5_ping(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            seq = qs.get("s", ["?"])[0]
            t = qs.get("t", ["?"])[0]
            msg = qs.get("m", [""])[0]
            if self.path.startswith("/__hb"):
                line = f"[{time.strftime('%H:%M:%S')}] hb  #{seq} +{t}ms"
            else:
                line = f"[{time.strftime('%H:%M:%S')}] LOG #{seq} +{t}ms | {msg}"
            emit(line)
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
        except Exception:
            self.send_error(500)


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            # Select an outgoing interface without sending application data.
            connection.connect(("192.0.2.1", 80))
            return connection.getsockname()[0]
    except OSError:
        pass

    try:
        addresses = socket.getaddrinfo(
            socket.gethostname(), None, socket.AF_INET, socket.SOCK_DGRAM
        )
        for address in addresses:
            ip = ipaddress.IPv4Address(address[4][0])
            if not (ip.is_loopback or ip.is_unspecified or ip.is_multicast):
                return str(ip)
    except OSError:
        pass

    return "localhost"


if __name__ == "__main__":
    emit(f"=== session start {time.strftime('%Y-%m-%d %H:%M:%S')} ===")
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler) as server:
        print(f"http://{local_ip()}:{PORT}/")
        server.serve_forever()
