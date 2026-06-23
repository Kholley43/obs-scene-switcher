/**
 * In-memory OBS client fake + optional WebSocket mock server (tests).
 */
import crypto from 'node:crypto';
import { createServer } from 'node:http';

const OP = { Hello: 0, Identify: 1, Identified: 2, Request: 6, RequestResponse: 7 };

function b64(buf) {
  return Buffer.from(buf).toString('base64');
}

function authSecret(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

/** Drop-in fake for integration tests without OBS installed. */
export class FakeObsClient {
  constructor({ scenes = [], current = null, failSet = null } = {}) {
    this.scenes = [...scenes];
    this.current = current || this.scenes[0] || '';
    this.failSet = failSet;
    this.connected = false;
  }

  async connect() {
    this.connected = true;
  }

  async close() {
    this.connected = false;
  }

  async getSceneList() {
    return [...this.scenes];
  }

  async getCurrentScene() {
    return this.current;
  }

  async setScene(name) {
    if (this.failSet) throw new Error(this.failSet);
    if (!this.scenes.includes(name)) throw new Error(`Scene not found: ${name}`);
    this.current = name;
    return name;
  }
}

/**
 * Real OBS WebSocket v5 mock (requires `ws` package in this folder).
 * @param {{ password?: string, scenes?: string[], startScene?: string }} opts
 */
export async function startMockObsServer(opts = {}) {
  let WebSocketServer;
  try {
    ({ WebSocketServer } = await import('ws'));
  } catch {
    throw new Error('Install ws for server mock: cd scripts/obs-scene-switcher && npm install');
  }

  const password = opts.password ?? 'test-secret';
  const scenes = opts.scenes || ['EURUSD', 'AUDUSD', 'XAU', 'Manual TA'];
  let current = opts.startScene || scenes[0];
  const salt = b64(crypto.randomBytes(16));
  const challenge = b64(crypto.randomBytes(16));

  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const sockets = new Set();

  wss.on('connection', (ws) => {
    sockets.add(ws);
    let identified = false;

    ws.send(
      JSON.stringify({
        op: OP.Hello,
        d: {
          obsWebSocketVersion: '5.0.0',
          rpcVersion: 1,
          authentication: { challenge, salt },
        },
      })
    );

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.op === OP.Identify) {
        const expected = authSecret(password, salt, challenge);
        if (msg.d?.authentication !== expected) {
          ws.close();
          return;
        }
        identified = true;
        ws.send(JSON.stringify({ op: OP.Identified, d: { negotiatedRpcVersion: 1 } }));
        return;
      }
      if (msg.op !== OP.Request || !identified) return;
      const type = msg.d?.requestType;
      const id = msg.d?.requestId;
      const respond = (responseData, code = 100, comment = '') => {
        ws.send(
          JSON.stringify({
            op: OP.RequestResponse,
            d: {
              requestId: id,
              requestStatus: { code, result: code === 100, comment },
              responseData: responseData || {},
            },
          })
        );
      };
      if (type === 'GetSceneList') {
        respond({ scenes: scenes.map((sceneName) => ({ sceneName })) });
        return;
      }
      if (type === 'GetCurrentProgramScene') {
        respond({ currentProgramSceneName: current });
        return;
      }
      if (type === 'SetCurrentProgramScene') {
        const name = msg.d?.requestData?.sceneName;
        if (!scenes.includes(name)) {
          respond(null, 600, `Scene not found: ${name}`);
          return;
        }
        current = name;
        respond({});
        return;
      }
      respond(null, 500, `Unknown request ${type}`);
    });

    ws.on('close', () => sockets.delete(ws));
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;

  return {
    port,
    password,
    scenes,
    getCurrent: () => current,
    async close() {
      for (const ws of sockets) {
        try {
          ws.close();
        } catch (_) {}
      }
      await new Promise((resolve) => wss.close(() => resolve()));
      await new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}
