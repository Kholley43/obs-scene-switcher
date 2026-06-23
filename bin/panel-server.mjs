#!/usr/bin/env node
/**
 * Local web control panel for OBS scene switching.
 *   node bin/panel-server.mjs
 *   node bin/panel-server.mjs --port 8765
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configPath,
  loadConfig,
  saveConfigSettings,
  gotoAlias,
  listScenes,
  validateConfig,
  stepRotate,
  runRotateLoop,
  rotatePool,
  createClient,
} from '../lib/switcher.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = path.join(__dirname, '..', 'panel');

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) flags.config = argv[++i];
    else if (argv[i] === '--port' && argv[i + 1]) flags.port = Number(argv[++i]);
  }
  return flags;
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.ico': 'image/x-icon' };
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(data);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  let cfg = loadConfig(configPath(flags.config));
  let client = null;
  let connected = false;
  let currentScene = null;
  let rotating = false;
  let rotateAbort = null;
  let nextSwitchAt = null;
  let lastSwitch = null;
  let lastError = null;
  const log = [];

  function pushLog(msg) {
    const entry = { at: new Date().toISOString(), msg };
    log.unshift(entry);
    if (log.length > 30) log.length = 30;
  }

  async function ensureClient() {
    if (client?.ws?.readyState === 1) return client;
    if (client) {
      try {
        await client.close();
      } catch (_) {}
    }
    client = createClient(cfg);
    await client.connect();
    connected = true;
    lastError = null;
    return client;
  }

  async function refreshCurrent() {
    try {
      const obs = await ensureClient();
      currentScene = await obs.getCurrentScene();
      connected = true;
      lastError = null;
    } catch (e) {
      connected = false;
      lastError = e.message || String(e);
      client = null;
    }
  }

  async function stopRotate() {
    if (rotateAbort) {
      rotateAbort.abort();
      rotateAbort = null;
    }
    rotating = false;
    nextSwitchAt = null;
  }

  async function startRotate(intervalSec) {
    await stopRotate();
    const obs = await ensureClient();
    rotateAbort = new AbortController();
    rotating = true;
    const interval = Math.max(5, Number(intervalSec) || cfg.rotateIntervalSec);
    nextSwitchAt = Date.now() + interval * 1000;
    pushLog(`Auto-rotate started (${interval}s)`);

    runRotateLoop(cfg, {
      intervalSec: interval,
      client: obs,
      signal: rotateAbort.signal,
      onSwitch: ({ alias, from, to, reason }) => {
        currentScene = to;
        lastSwitch = { alias, from, to, reason, at: new Date().toISOString() };
        nextSwitchAt = Date.now() + interval * 1000;
        const tag = reason === 'init' ? 'start' : 'rotate';
        pushLog(`[${tag}] ${alias}: ${from || '—'} → ${to}`);
      },
    })
      .catch((e) => {
        if (e.message !== 'aborted') {
          lastError = e.message || String(e);
          pushLog(`Rotate error: ${lastError}`);
        }
      })
      .finally(() => {
        rotating = false;
        nextSwitchAt = null;
        rotateAbort = null;
      });
  }

  const port = flags.port || Number(process.env.OBS_PANEL_PORT) || cfg.panelPort || 8765;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    try {
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return serveStatic(res, path.join(PANEL_DIR, 'index.html'));
      }
      if (req.method === 'GET' && pathname.startsWith('/panel/')) {
        return serveStatic(res, path.join(PANEL_DIR, pathname.slice('/panel/'.length)));
      }

      if (pathname === '/api/status' && req.method === 'GET') {
        if (!currentScene && !lastError) await refreshCurrent();
        const pool = rotatePool(cfg);
        return json(res, 200, {
          connected,
          currentScene,
          rotating,
          rotateIntervalSec: cfg.rotateIntervalSec,
          includeManualInRotate: cfg.includeManualInRotate,
          nextSwitchAt,
          lastSwitch,
          lastError,
          scenes: cfg.scenes.map((s) => ({
            alias: s.alias,
            obsScene: s.obsScene,
            kind: s.kind,
            inRotate: pool.some((p) => p.alias === s.alias),
          })),
          log,
        });
      }

      if (pathname === '/api/refresh' && req.method === 'POST') {
        await refreshCurrent();
        return json(res, 200, { ok: true, currentScene, connected, lastError });
      }

      if (pathname === '/api/validate' && req.method === 'POST') {
        const report = await validateConfig(cfg, await ensureClient());
        if (!report.ok) pushLog(`Validate failed: ${report.missing.length} missing scene(s)`);
        else pushLog('Validate OK');
        return json(res, 200, report);
      }

      if (pathname === '/api/goto' && req.method === 'POST') {
        const body = await readBody(req);
        const obs = await ensureClient();
        const result = await gotoAlias(cfg, body.alias, obs);
        currentScene = result.obsScene;
        lastSwitch = {
          alias: result.scene.alias,
          from: null,
          to: result.obsScene,
          reason: 'goto',
          at: new Date().toISOString(),
        };
        pushLog(`Goto ${result.scene.alias} → ${result.obsScene}`);
        return json(res, 200, { ok: true, ...result });
      }

      if (pathname === '/api/next' && req.method === 'POST') {
        const obs = await ensureClient();
        const result = await stepRotate(cfg, 'next', obs);
        currentScene = result.to;
        lastSwitch = { ...result, reason: 'next', at: new Date().toISOString() };
        pushLog(`Next: ${result.alias} (${result.from} → ${result.to})`);
        return json(res, 200, { ok: true, ...result });
      }

      if (pathname === '/api/prev' && req.method === 'POST') {
        const obs = await ensureClient();
        const result = await stepRotate(cfg, 'prev', obs);
        currentScene = result.to;
        lastSwitch = { ...result, reason: 'prev', at: new Date().toISOString() };
        pushLog(`Prev: ${result.alias} (${result.from} → ${result.to})`);
        return json(res, 200, { ok: true, ...result });
      }

      if (pathname === '/api/rotate/start' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.rotateIntervalSec != null || body.includeManualInRotate != null) {
          cfg = saveConfigSettings(cfg.configFile, {
            rotateIntervalSec: body.rotateIntervalSec ?? cfg.rotateIntervalSec,
            includeManualInRotate: body.includeManualInRotate ?? cfg.includeManualInRotate,
          });
        }
        await startRotate(body.rotateIntervalSec ?? cfg.rotateIntervalSec);
        return json(res, 200, { ok: true, rotating: true, rotateIntervalSec: cfg.rotateIntervalSec });
      }

      if (pathname === '/api/rotate/stop' && req.method === 'POST') {
        await stopRotate();
        pushLog('Auto-rotate stopped');
        return json(res, 200, { ok: true, rotating: false });
      }

      if (pathname === '/api/settings' && req.method === 'PATCH') {
        const body = await readBody(req);
        cfg = saveConfigSettings(cfg.configFile, body);
        pushLog('Settings saved to config.json');
        return json(res, 200, {
          ok: true,
          rotateIntervalSec: cfg.rotateIntervalSec,
          includeManualInRotate: cfg.includeManualInRotate,
        });
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (e) {
      lastError = e.message || String(e);
      pushLog(`Error: ${lastError}`);
      json(res, 500, { ok: false, error: lastError });
    }
  });

  server.listen(port, '127.0.0.1', async () => {
    console.log(`OBS Scene Switcher panel: http://127.0.0.1:${port}`);
    console.log('Leave this window open while streaming. Ctrl+C to stop.');
    await refreshCurrent();
    if (connected) {
      console.log(`Connected — current scene: ${currentScene}`);
    } else {
      console.log(`OBS not connected yet: ${lastError || 'unknown'}`);
    }
  });

  const shutdown = async () => {
    await stopRotate();
    if (client) await client.close().catch(() => {});
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
