import http.client
import http.server
from pathlib import Path
import runpy
import socket
import tempfile
import threading
import unittest
from unittest import mock

import serve


def address_info(ip):
    return (socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP, "", (ip, 0))


class LocalIpTests(unittest.TestCase):
    def test_route_address_accepts_all_private_network_ranges(self):
        with mock.patch("socket.socket") as factory:
            connection = factory.return_value.__enter__.return_value
            for ip in ("10.0.0.2", "172.16.0.2", "192.168.1.2"):
                with self.subTest(ip=ip):
                    connection.getsockname.return_value = (ip, 12345)
                    self.assertEqual(serve.local_ip(), ip)

    def test_route_failure_uses_hostname_address(self):
        addresses = [address_info(ip) for ip in (
            "127.0.0.1", "0.0.0.0", "224.0.0.1", "10.0.0.2"
        )]
        with mock.patch("socket.socket") as factory, mock.patch(
            "socket.getaddrinfo", return_value=addresses
        ):
            connection = factory.return_value.__enter__.return_value
            connection.connect.side_effect = OSError("No route")
            self.assertEqual(serve.local_ip(), "10.0.0.2")

    def test_socket_creation_failure_uses_hostname_address(self):
        with mock.patch("socket.socket", side_effect=OSError), mock.patch(
            "socket.getaddrinfo", return_value=[address_info("172.20.0.2")]
        ):
            self.assertEqual(serve.local_ip(), "172.20.0.2")

    def test_no_usable_hostname_address_returns_localhost(self):
        with mock.patch("socket.socket", side_effect=OSError), mock.patch(
            "socket.getaddrinfo", return_value=[address_info("127.0.0.1")]
        ):
            self.assertEqual(serve.local_ip(), "localhost")

    def test_discovery_failure_returns_localhost(self):
        with mock.patch("socket.socket", side_effect=OSError), mock.patch(
            "socket.getaddrinfo", side_effect=socket.gaierror
        ):
            self.assertEqual(serve.local_ip(), "localhost")

    def test_discovery_failure_does_not_prevent_server_startup(self):
        with mock.patch("socket.socket", side_effect=OSError), mock.patch(
            "socket.getaddrinfo", side_effect=socket.gaierror
        ), mock.patch("http.server.ThreadingHTTPServer") as factory, mock.patch(
            "builtins.print"
        ) as output, mock.patch("builtins.open", mock.mock_open()):
            runpy.run_path(str(Path(serve.__file__)), run_name="__main__")
            factory.return_value.__enter__.return_value.serve_forever.assert_called_once()
            output.assert_any_call("http://localhost:8000/")


class HandlerTests(unittest.TestCase):
    def test_serves_configured_root_with_no_store_header(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch(
            "serve.ROOT", Path(directory)
        ), mock.patch("serve.emit"):
            content = b"local static server test"
            Path(directory, "index.html").write_bytes(content)
            with http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler) as server:
                thread = threading.Thread(
                    target=server.serve_forever, kwargs={"poll_interval": 0.01}
                )
                thread.start()
                client = http.client.HTTPConnection(*server.server_address, timeout=5)
                try:
                    client.request("GET", "/")
                    response = client.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.getheader("Cache-Control"), "no-store")
                    self.assertEqual(response.read(), content)
                finally:
                    client.close()
                    server.shutdown()
                    thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
