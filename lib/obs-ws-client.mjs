/**
 * Minimal OBS WebSocket v5 client.
 * Uses global WebSocket (Node 18.18+) or falls back to npm `ws` on Linux.
 * https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 */
import crypto from 'node:crypto';
import {
  resolveWebSocket,
  bindSocketOpenError,
  bindSocketMessage,
  bindSocketClose,
  socketOpenConstant,
} from './websocket.mjs';

const { WS: WebSocket, kind: wsKind } = resolveWebSocket();
const WS_OPEN = socketOpenConstant(WebSocket);

const OP = {
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Event: 5,
  Request: 6,
  RequestResponse: 7,
};

/** OBS WebSocket v5 auth: base64(sha256(base64(sha256(password+salt)) + challenge)) */
function authSecret(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

function makeRequestId() {
  return `nexus-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ObsWsClient {
  /**
   * @param {{ host?: string, port?: number, password?: string, timeoutMs?: number }} opts
   */
  constructor(opts = {}) {
    this.host = opts.host || '127.0.0.1';
    this.port = Number(opts.port) || 4455;
    this.password = String(opts.password || '');
    this.timeoutMs = Number(opts.timeoutMs) || 8000;
    this.ws = null;
    this.pending = new Map();
    this._unbindMessage = null;
    this._unbindClose = null;
  }

  get url() {
    return `ws://${this.host}:${this.port}`;
  }

  async connect() {
    if (this.ws?.readyState === WS_OPEN) return;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch (_) {}
        reject(new Error(`OBS WebSocket connect timeout (${this.url})`));
      }, this.timeoutMs);
      const onOpen = () => {
        clearTimeout(timer);
        cleanup();
        this.ws = ws;
        this._unbindMessage = bindSocketMessage(
          ws,
          (data) => this.#onMessage(data),
          wsKind
        );
        this._unbindClose = bindSocketClose(
          ws,
          () => {
            for (const [, p] of this.pending) {
              p.reject(new Error('OBS WebSocket closed'));
            }
            this.pending.clear();
          },
          wsKind
        );
        resolve();
      };
      const onError = (ev) => {
        clearTimeout(timer);
        cleanup();
        const msg =
          wsKind === 'ws'
            ? ev?.message || String(ev || 'connection failed')
            : ev?.message || 'connection failed';
        reject(new Error(`OBS WebSocket error: ${msg}`));
      };
      const cleanup = bindSocketOpenError(ws, { onOpen, onError }, wsKind);
    });
    await this.#handshake();
  }

  async close() {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    this._unbindMessage?.();
    this._unbindMessage = null;
    this._unbindClose?.();
    this._unbindClose = null;
    await new Promise((resolve) => {
      const done = () => resolve();
      bindSocketClose(ws, done, wsKind);
      try {
        ws.close();
      } catch (_) {
        resolve();
      }
      setTimeout(done, 200);
    });
  }

  async #handshake() {
    const hello = await this.#waitOp(OP.Hello, this.timeoutMs);
    const auth = hello?.d?.authentication;
    const identify = { rpcVersion: 1 };
    if (auth?.challenge && auth?.salt) {
      if (!this.password) {
        throw new Error('OBS requires WebSocket password — set password in config.json');
      }
      identify.authentication = authSecret(this.password, auth.salt, auth.challenge);
    }
    this.#send(OP.Identify, identify);
    await this.#waitOp(OP.Identified, this.timeoutMs);
  }

  #send(op, data) {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      throw new Error('OBS WebSocket not connected');
    }
    this.ws.send(JSON.stringify({ op, d: data }));
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.op === OP.RequestResponse) {
      const id = msg?.d?.requestId;
      const pending = id && this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      const code = msg?.d?.requestStatus?.code;
      if (code !== 100) {
        const comment = msg?.d?.requestStatus?.comment || `OBS error code ${code}`;
        pending.reject(new Error(comment));
        return;
      }
      pending.resolve(msg.d?.responseData ?? {});
      return;
    }
    if (msg.op === OP.Hello || msg.op === OP.Identified) {
      for (const [id, p] of this.pending) {
        if (p.expectOp === msg.op) {
          this.pending.delete(id);
          p.resolve(msg);
          return;
        }
      }
    }
  }

  #waitOp(expectOp, ms) {
    return new Promise((resolve, reject) => {
      const id = makeRequestId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OBS handshake timeout waiting for op ${expectOp}`));
      }, ms);
      this.pending.set(id, {
        expectOp,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  async request(requestType, requestData = {}) {
    await this.connect();
    const requestId = makeRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS request timeout: ${requestType}`));
      }, this.timeoutMs);
      this.pending.set(requestId, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.#send(OP.Request, { requestType, requestId, requestData });
    });
  }

  async getSceneList() {
    const data = await this.request('GetSceneList');
    const scenes = Array.isArray(data?.scenes) ? data.scenes : [];
    return scenes.map((s) => String(s.sceneName || s.name || '')).filter(Boolean);
  }

  async getCurrentScene() {
    const data = await this.request('GetCurrentProgramScene');
    return String(data?.currentProgramSceneName || data?.sceneName || '');
  }

  async setScene(sceneName) {
    const name = String(sceneName || '').trim();
    if (!name) throw new Error('scene name required');
    await this.request('SetCurrentProgramScene', { sceneName: name });
    return name;
  }
}
