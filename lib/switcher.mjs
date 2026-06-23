/**
 * Config-driven OBS scene switching for multi-pair streams.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObsWsClient } from './obs-ws-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = path.join(__dirname, '..', 'config.json');

export function configPath(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.OBS_SCENE_CONFIG) return path.resolve(process.env.OBS_SCENE_CONFIG);
  return DEFAULT_CONFIG;
}

export function readConfigFile(file = configPath()) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing config: ${file}\nCopy config.example.json → config.json and rename obsScene values to match OBS.`
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveConfigSettings(file, patch = {}) {
  const raw = readConfigFile(file);
  if (patch.rotateIntervalSec != null) {
    raw.rotateIntervalSec = Math.max(5, Number(patch.rotateIntervalSec) || 45);
  }
  if (patch.includeManualInRotate != null) {
    raw.includeManualInRotate = patch.includeManualInRotate === true;
  }
  if (patch.panelPort != null) {
    raw.panelPort = Math.max(1024, Math.min(65535, Number(patch.panelPort) || 8765));
  }
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return loadConfig(file);
}

export function loadConfig(file = configPath()) {
  const raw = readConfigFile(file);
  const scenes = (raw.scenes || []).map((s, i) => ({
    id: String(s.id || s.alias || `scene-${i}`).toLowerCase(),
    alias: String(s.alias || s.id || '').toUpperCase(),
    obsScene: String(s.obsScene || s.scene || s.alias || '').trim(),
    kind: String(s.kind || 'pair').toLowerCase(),
  }));
  if (!scenes.length) throw new Error('config.scenes is empty');
  for (const s of scenes) {
    if (!s.obsScene) throw new Error(`Scene "${s.alias}" missing obsScene name`);
  }
  return {
    host: raw.host || '127.0.0.1',
    port: Number(raw.port) || 4455,
    password: String(raw.password || ''),
    rotateIntervalSec: Math.max(5, Number(raw.rotateIntervalSec) || 45),
    includeManualInRotate: raw.includeManualInRotate === true,
    panelPort: Math.max(1024, Math.min(65535, Number(raw.panelPort) || 8765)),
    scenes,
    configFile: file,
  };
}

export function normalizeKey(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function findScene(cfg, key) {
  const norm = normalizeKey(key);
  if (!norm) return null;
  return (
    cfg.scenes.find((s) => normalizeKey(s.alias) === norm) ||
    cfg.scenes.find((s) => normalizeKey(s.id) === norm) ||
    cfg.scenes.find((s) => normalizeKey(s.obsScene) === norm) ||
    null
  );
}

export function rotatePool(cfg) {
  return cfg.scenes.filter((s) => cfg.includeManualInRotate || s.kind !== 'manual');
}

export function nextScene(cfg, currentObsScene) {
  const pool = rotatePool(cfg);
  if (!pool.length) throw new Error('rotate pool is empty');
  const cur = String(currentObsScene || '');
  const idx = pool.findIndex((s) => s.obsScene === cur);
  const next = pool[(idx + 1) % pool.length];
  return next;
}

export function prevScene(cfg, currentObsScene) {
  const pool = rotatePool(cfg);
  if (!pool.length) throw new Error('rotate pool is empty');
  const cur = String(currentObsScene || '');
  const idx = pool.findIndex((s) => s.obsScene === cur);
  const base = idx < 0 ? 0 : idx;
  const prev = pool[(base - 1 + pool.length) % pool.length];
  return prev;
}

export function validateConfigAgainstObs(cfg, obsSceneNames) {
  const have = new Set(obsSceneNames.map((n) => String(n)));
  const missing = cfg.scenes.filter((s) => !have.has(s.obsScene));
  const extras = [...have].filter(
    (n) => !cfg.scenes.some((s) => s.obsScene === n) && !/^scene$/i.test(n)
  );
  return { ok: missing.length === 0, missing, obsSceneNames: [...have], extras };
}

export function createClient(cfg) {
  return new ObsWsClient({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
  });
}

export async function gotoAlias(cfg, key, client = null) {
  const scene = findScene(cfg, key);
  if (!scene) {
    const aliases = cfg.scenes.map((s) => s.alias).join(', ');
    throw new Error(`Unknown scene alias "${key}" — expected one of: ${aliases}`);
  }
  const obs = client || createClient(cfg);
  const own = !client;
  try {
    await obs.setScene(scene.obsScene);
    return { scene, obsScene: scene.obsScene };
  } finally {
    if (own) await obs.close();
  }
}

export async function listScenes(cfg, client = null) {
  const obs = client || createClient(cfg);
  const own = !client;
  try {
    const names = await obs.getSceneList();
    const current = await obs.getCurrentScene();
    return { names, current };
  } finally {
    if (own) await obs.close();
  }
}

export async function validateConfig(cfg, client = null) {
  const { names, current } = await listScenes(cfg, client);
  const report = validateConfigAgainstObs(cfg, names);
  return { ...report, current };
}

export async function stepRotate(cfg, direction = 'next', client = null) {
  const obs = client || createClient(cfg);
  const own = !client;
  try {
    const current = await obs.getCurrentScene();
    const target = direction === 'prev' ? prevScene(cfg, current) : nextScene(cfg, current);
    await obs.setScene(target.obsScene);
    return { from: current, to: target.obsScene, alias: target.alias };
  } finally {
    if (own) await obs.close();
  }
}

/**
 * Auto Scene Switcher loop — rotates program scene every N seconds.
 * @param {object} cfg
 * @param {{ intervalSec?: number, onSwitch?: Function, signal?: AbortSignal }} opts
 */
export async function runRotateLoop(cfg, opts = {}) {
  const raw = Number(opts.intervalSec) || cfg.rotateIntervalSec;
  const intervalSec = opts.allowSubSecond ? Math.max(0, raw) : Math.max(5, raw);
  const obs = opts.client || createClient(cfg);
  const own = !opts.client;
  const pool = rotatePool(cfg);
  if (!pool.length) throw new Error('rotate pool is empty (check includeManualInRotate / scenes)');

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  if (opts.signal) {
    if (opts.signal.aborted) stopped = true;
    opts.signal.addEventListener('abort', stop, { once: true });
  }

  try {
    await obs.connect();
    let current = await obs.getCurrentScene();
    if (!pool.some((s) => s.obsScene === current)) {
      const first = pool[0];
      await obs.setScene(first.obsScene);
      current = first.obsScene;
      opts.onSwitch?.({ from: null, to: first.obsScene, alias: first.alias, reason: 'init' });
    }

    while (!stopped) {
      await sleep(intervalSec * 1000, opts.signal);
      if (stopped) break;
      const target = nextScene(cfg, current);
      await obs.setScene(target.obsScene);
      const payload = { from: current, to: target.obsScene, alias: target.alias, reason: 'rotate' };
      current = target.obsScene;
      opts.onSwitch?.(payload);
    }
  } finally {
    if (own) await obs.close();
  }
}

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        },
        { once: true }
      );
    }
  });
}
