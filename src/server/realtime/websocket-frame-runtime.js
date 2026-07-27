"use strict";

function createWebSocketFrameRuntime(options = {}) {
  const states = new WeakMap();
  const maxMessageBytes = Math.max(64 * 1024, Number(options.maxMessageBytes) || 1024 * 1024);
  const maxBufferedBytes = Math.max(maxMessageBytes, Number(options.maxBufferedBytes) || maxMessageBytes * 2);

  function forget(socket) {
    states.delete(socket);
  }

  function fail(socket, reason) {
    forget(socket);
    options.onProtocolError?.(socket, reason);
    return { messages: [], pingPayloads: [], closeRequested: false, protocolError: reason };
  }

  function push(socket, chunk) {
    if (!socket || !Buffer.isBuffer(chunk) || chunk.length === 0) {
      return { messages: [], pingPayloads: [], closeRequested: false, protocolError: "" };
    }
    const state = states.get(socket) || {
      buffer: Buffer.alloc(0),
      fragmentOpcode: 0,
      fragments: [],
      fragmentedBytes: 0
    };
    state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
    states.set(socket, state);
    if (state.buffer.length > maxBufferedBytes) return fail(socket, "buffer_limit");

    const messages = [];
    const pingPayloads = [];
    let closeRequested = false;
    let offset = 0;

    while (offset + 2 <= state.buffer.length) {
      const frameStart = offset;
      const first = state.buffer[offset++];
      const second = state.buffer[offset++];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      let length = second & 0x7f;
      if ((first & 0x70) !== 0) return fail(socket, "unsupported_extension");
      if (length === 126) {
        if (offset + 2 > state.buffer.length) { offset = frameStart; break; }
        length = state.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (offset + 8 > state.buffer.length) { offset = frameStart; break; }
        const wideLength = state.buffer.readBigUInt64BE(offset);
        if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) return fail(socket, "invalid_length");
        length = Number(wideLength);
        offset += 8;
      }
      const masked = (second & 0x80) !== 0;
      if (masked && offset + 4 > state.buffer.length) { offset = frameStart; break; }
      const mask = masked ? state.buffer.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;
      if (length > maxMessageBytes) return fail(socket, "message_limit");
      if (offset + length > state.buffer.length) { offset = frameStart; break; }

      const payload = Buffer.from(state.buffer.subarray(offset, offset + length));
      offset += length;
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }

      if (opcode >= 0x8) {
        if (!fin || length > 125) return fail(socket, "invalid_control_frame");
        if (opcode === 0x8) closeRequested = true;
        else if (opcode === 0x9) pingPayloads.push(payload);
        else if (opcode !== 0xA) return fail(socket, "unsupported_opcode");
        continue;
      }

      if (opcode === 0x1) {
        if (state.fragmentOpcode) return fail(socket, "nested_fragment");
        if (fin) messages.push(payload.toString("utf8"));
        else {
          state.fragmentOpcode = opcode;
          state.fragments = [payload];
          state.fragmentedBytes = payload.length;
        }
      } else if (opcode === 0x0) {
        if (!state.fragmentOpcode) return fail(socket, "unexpected_continuation");
        state.fragments.push(payload);
        state.fragmentedBytes += payload.length;
        if (state.fragmentedBytes > maxMessageBytes) return fail(socket, "message_limit");
        if (fin) {
          messages.push(Buffer.concat(state.fragments, state.fragmentedBytes).toString("utf8"));
          state.fragmentOpcode = 0;
          state.fragments = [];
          state.fragmentedBytes = 0;
        }
      } else {
        return fail(socket, "unsupported_opcode");
      }
    }

    state.buffer = offset < state.buffer.length
      ? Buffer.from(state.buffer.subarray(offset))
      : Buffer.alloc(0);
    return { messages, pingPayloads, closeRequested, protocolError: "" };
  }

  return { push, forget };
}

function encodeControlFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (body.length > 125) throw new RangeError("WebSocket control payload exceeds 125 bytes");
  return Buffer.concat([Buffer.from([0x80 | (opcode & 0x0f), body.length]), body]);
}

module.exports = { createWebSocketFrameRuntime, encodeControlFrame };
