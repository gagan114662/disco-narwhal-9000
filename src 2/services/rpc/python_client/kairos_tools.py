import json
import os
import socket
from contextlib import AbstractContextManager


class KairosToolsClient(AbstractContextManager):
    def __init__(self, socket_path=None, token=None):
        self.socket_path = socket_path or os.environ.get("KAIROS_SOCKET")
        self.token = token or os.environ.get("KAIROS_TOKEN")
        if not self.socket_path:
            raise RuntimeError("KAIROS_SOCKET is not set")
        if not self.token:
            raise RuntimeError("KAIROS_TOKEN is not set")
        self._socket = None
        self._reader = None
        self._writer = None

    def __enter__(self):
        self._socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._socket.connect(self.socket_path)
        self._reader = self._socket.makefile("r", encoding="utf-8")
        self._writer = self._socket.makefile("w", encoding="utf-8")
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._reader:
            self._reader.close()
        if self._writer:
            self._writer.close()
        if self._socket:
            self._socket.close()
        self._reader = None
        self._writer = None
        self._socket = None
        return False

    def _send(self, method, params):
        if not self._reader or not self._writer:
            raise RuntimeError("Client is not connected; use `with KairosToolsClient()`")
        request = {
            "id": 1,
            "method": method,
            "params": {
                "token": self.token,
                **params,
            },
        }
        self._writer.write(json.dumps(request) + "\n")
        self._writer.flush()
        line = self._reader.readline()
        if not line:
            raise RuntimeError("No response from KAIROS RPC server")
        response = json.loads(line)
        if response.get("error"):
            error = response["error"]
            raise RuntimeError(error.get("message", "Unknown RPC error"))
        return response.get("result")

    def list_tools(self):
        return self._send("list_tools", {})

    def call(self, tool_name, args=None):
        return self._send(
            "call_tool",
            {
                "tool_name": tool_name,
                "args": args or {},
            },
        )


def list_tools():
    with KairosToolsClient() as client:
        return client.list_tools()


def call(tool_name, args=None):
    with KairosToolsClient() as client:
        return client.call(tool_name, args or {})

