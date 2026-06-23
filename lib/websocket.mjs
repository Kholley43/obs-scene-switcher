/**
 * WebSocket for OBS client — Node 18.18+ global, or `ws` package on Linux builds without it.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(import.meta.url));

let cached = null;

export function resolveWebSocket() {
  if (cached) return cached;
  if (globalThis.WebSocket) {
    cached = { WS: globalThis.WebSocket, kind: 'global' };
    return cached;
  }
  try {
    const WS = require('ws');
    cached = { WS, kind: 'ws' };
    return cached;
  } catch {
    throw new Error(
      'WebSocket not available. On Linux run: npm install   (installs the ws package). ' +
        'Or use Node 18.18+ from nodejs.org / NodeSource — some distro packages omit global WebSocket.'
    );
  }
}

export function webSocketAvailable() {
  try {
    resolveWebSocket();
    return true;
  } catch {
    return false;
  }
}

/** Attach open/error handlers — works with browser WebSocket and `ws` package. */
export function bindSocketOpenError(ws, { onOpen, onError }, kind) {
  if (kind === 'ws') {
    ws.once('open', onOpen);
    ws.once('error', onError);
    return () => {
      ws.removeListener('open', onOpen);
      ws.removeListener('error', onError);
    };
  }
  ws.addEventListener('open', onOpen);
  ws.addEventListener('error', onError);
  return () => {
    ws.removeEventListener('open', onOpen);
    ws.removeEventListener('error', onError);
  };
}

export function bindSocketMessage(ws, handler, kind) {
  if (kind === 'ws') {
    ws.on('message', handler);
    return () => ws.removeListener('message', handler);
  }
  const wrapped = (ev) => handler(ev.data);
  ws.addEventListener('message', wrapped);
  return () => ws.removeEventListener('message', wrapped);
}

export function bindSocketClose(ws, handler, kind) {
  if (kind === 'ws') {
    ws.on('close', handler);
    return () => ws.removeListener('close', handler);
  }
  ws.addEventListener('close', handler);
  return () => ws.removeEventListener('close', handler);
}

export function socketOpenConstant(WS) {
  return WS.OPEN ?? 1;
}
