"use strict";

function createSocketWriteRuntime(deps = {}) {
  const states = new WeakMap();
  const maxQueuedBytes = Math.max(64 * 1024, Number(deps.maxQueuedBytes) || 2 * 1024 * 1024);

  function frameBytes(frame) {
    return Buffer.isBuffer(frame) ? frame.length : Buffer.byteLength(String(frame || ""));
  }

  function forget(socket) {
    const state = states.get(socket);
    if (state?.drainAttached && state.drainHandler) socket.off?.("drain", state.drainHandler);
    if (state) {
      state.queue.length = 0;
      state.queuedBytes = 0;
      state.inFlightBytes = 0;
      state.drainAttached = false;
      state.drainHandler = null;
    }
    states.delete(socket);
  }

  function overflow(socket, state) {
    const detail = {
      queuedBytes: state.queuedBytes + state.inFlightBytes,
      queuedMessages: state.queue.length + (state.inFlightBytes > 0 ? 1 : 0)
    };
    forget(socket);
    deps.onOverflow?.(socket, detail);
    socket.destroy?.();
    return false;
  }

  function attachDrain(socket, state) {
    if (state.drainAttached) return;
    state.drainAttached = true;
    state.drainHandler = () => {
      state.drainAttached = false;
      state.drainHandler = null;
      state.draining = false;
      state.inFlightBytes = 0;
      flush(socket, state);
    };
    socket.once("drain", state.drainHandler);
  }

  function writeNow(socket, state, entry) {
    let accepted = false;
    try {
      accepted = socket.write(entry.frame);
    } catch {
      forget(socket);
      return false;
    }
    deps.onWrite?.(entry.type, entry.bytes);
    if (!accepted) {
      state.draining = true;
      state.inFlightBytes = Math.max(entry.bytes, Number(socket.writableLength) || 0);
      if (state.inFlightBytes + state.queuedBytes > maxQueuedBytes) return overflow(socket, state);
      attachDrain(socket, state);
    }
    return true;
  }

  function flush(socket, state) {
    if (!socket || socket.destroyed) {
      forget(socket);
      return;
    }
    while (!state.draining && state.queue.length) {
      const entry = state.queue.shift();
      state.queuedBytes -= entry.bytes;
      if (!writeNow(socket, state, entry)) return;
    }
  }

  function write(socket, frame, type = "unknown", options = {}) {
    if (!socket || socket.destroyed) return false;
    const state = states.get(socket) || {
      queue: [],
      queuedBytes: 0,
      inFlightBytes: 0,
      draining: false,
      drainAttached: false,
      drainHandler: null
    };
    states.set(socket, state);
    const entry = { frame, type, bytes: frameBytes(frame), coalesceKey: String(options.coalesceKey || "") };
    if (!state.draining) return writeNow(socket, state, entry);
    if (entry.coalesceKey) {
      const existingIndex = state.queue.findIndex((queued) => queued.coalesceKey === entry.coalesceKey);
      if (existingIndex >= 0) {
        state.queuedBytes -= state.queue[existingIndex].bytes;
        state.queue[existingIndex] = entry;
        state.queuedBytes += entry.bytes;
        if (state.inFlightBytes + state.queuedBytes > maxQueuedBytes) return overflow(socket, state);
        return false;
      }
    }
    state.queue.push(entry);
    state.queuedBytes += entry.bytes;
    if (state.inFlightBytes + state.queuedBytes > maxQueuedBytes) return overflow(socket, state);
    return false;
  }

  return { write, forget };
}

module.exports = { createSocketWriteRuntime };
