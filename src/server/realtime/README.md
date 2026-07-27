# Realtime server runtime

This directory contains bounded, dependency-injected infrastructure for the raw TCP/WebSocket realtime server.

## socket-write-runtime.js

- Keeps one `drain` listener per socket while backpressured.
- Preserves reliable frame order in a bounded queue.
- Coalesces explicitly replaceable state frames by key.
- Reports queue overflow through an injected callback before disconnecting the slow client.

## websocket-frame-runtime.js

- Incrementally decodes WebSocket frames across arbitrary TCP chunk boundaries.
- Supports text continuation frames and ping/close control frames.
- Enforces bounded message and receive-buffer sizes before handing data to business runtimes.
