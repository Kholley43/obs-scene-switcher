/**
 * Bulletproof smoke tests — no OBS install required.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObsWsClient } from '../lib/obs-ws-client.mjs';
import {
  loadConfig,
  saveConfigSettings,
  findScene,
  nextScene,
  prevScene,
  rotatePool,
  validateConfigAgainstObs,
  gotoAlias,
  stepRotate,
  validateConfig,
  runRotateLoop,
} from '../lib/switcher.mjs';
import { FakeObsClient, startMockObsServer } from './mock-obs-ws.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function writeTempConfig(overrides = {}) {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
  const cfg = { ...base, ...overrides };
  const file = path.join(os.tmpdir(), `obs-scene-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

// --- pure logic ---
{
  const cfg = loadConfig(writeTempConfig());
  assert.equal(findScene(cfg, 'xau')?.alias, 'XAU');
  assert.equal(findScene(cfg, 'manual')?.kind, 'manual');
  assert.equal(findScene(cfg, 'nope'), null);

  const pool = rotatePool(cfg);
  assert.ok(!pool.some((s) => s.kind === 'manual'), 'manual excluded by default');
  assert.equal(pool.length, cfg.scenes.length - 1);

  const withManual = loadConfig(writeTempConfig({ includeManualInRotate: true }));
  assert.equal(rotatePool(withManual).length, withManual.scenes.length);

  assert.equal(nextScene(cfg, 'EURUSD').alias, 'AUDUSD');
  assert.equal(prevScene(cfg, 'EURUSD').alias, 'BNB');
  assert.equal(nextScene(cfg, 'UNKNOWN').alias, 'EURUSD');

  const report = validateConfigAgainstObs(cfg, ['EURUSD', 'AUDUSD', 'XAU', 'XAG', 'BTC', 'ETH', 'SOL', 'BNB', 'Manual TA']);
  assert.equal(report.ok, true);
  const bad = validateConfigAgainstObs(cfg, ['EURUSD']);
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.length > 0);

  const tmp = writeTempConfig({ rotateIntervalSec: 60 });
  const saved = saveConfigSettings(tmp, { rotateIntervalSec: 90, includeManualInRotate: true });
  assert.equal(saved.rotateIntervalSec, 90);
  assert.equal(saved.includeManualInRotate, true);
  const reloaded = loadConfig(tmp);
  assert.equal(reloaded.rotateIntervalSec, 90);
}

// --- fake client integration ---
{
  const cfg = loadConfig(writeTempConfig());
  const fake = new FakeObsClient({
    scenes: cfg.scenes.map((s) => s.obsScene),
    current: 'EURUSD',
  });
  const res = await gotoAlias(cfg, 'BTC', fake);
  assert.equal(res.obsScene, 'BTC');
  assert.equal(await fake.getCurrentScene(), 'BTC');

  const step = await stepRotate(cfg, 'next', fake);
  assert.equal(step.from, 'BTC');
  assert.equal(step.to, 'ETH');

  const manual = await gotoAlias(cfg, 'MANUAL', fake);
  assert.equal(manual.obsScene, 'Manual TA');

  const report = await validateConfig(cfg, fake);
  assert.equal(report.ok, true);
}

// --- rotate loop ---
{
  const cfg = loadConfig(writeTempConfig({ rotateIntervalSec: 1 }));
  const fake = new FakeObsClient({
    scenes: rotatePool(cfg).map((s) => s.obsScene),
    current: 'EURUSD',
  });
  const ac = new AbortController();
  const seen = [];
  const loop = runRotateLoop(cfg, {
    intervalSec: 0.05,
    allowSubSecond: true,
    signal: ac.signal,
    client: fake,
    onSwitch: (p) => seen.push(p.alias),
  });
  await new Promise((r) => setTimeout(r, 180));
  ac.abort();
  try {
    await loop;
  } catch (e) {
    assert.equal(e.message, 'aborted');
  }
  assert.ok(seen.length >= 2, `expected rotations, got ${seen.length}`);
}

// --- real WebSocket protocol (optional ws package) ---
{
  let mock;
  try {
    mock = await startMockObsServer({
      password: 'test-secret',
      scenes: ['EURUSD', 'AUDUSD', 'XAU', 'Manual TA'],
      startScene: 'EURUSD',
    });
  } catch (e) {
    if (/Install ws/.test(e.message)) {
      console.log('obs-scene-switcher-smoke: SKIP WebSocket server test (npm install ws)');
    } else {
      throw e;
    }
  }
  if (mock) {
    const cfg = loadConfig(
      writeTempConfig({
        port: mock.port,
        password: mock.password,
        scenes: [
          { id: 'eurusd', alias: 'EURUSD', obsScene: 'EURUSD' },
          { id: 'audusd', alias: 'AUDUSD', obsScene: 'AUDUSD' },
          { id: 'xau', alias: 'XAU', obsScene: 'XAU' },
          { id: 'manual', alias: 'MANUAL', obsScene: 'Manual TA', kind: 'manual' },
        ],
      })
    );
    const client = new ObsWsClient({ host: '127.0.0.1', port: mock.port, password: mock.password });
    await gotoAlias(cfg, 'XAU', client);
    assert.equal(mock.getCurrent(), 'XAU');
    const step = await stepRotate(cfg, 'next', client);
    assert.equal(step.to, 'EURUSD');
    assert.equal(mock.getCurrent(), 'EURUSD');
    await client.close();
    await mock.close();
  }
}

console.log('obs-scene-switcher-smoke: OK');
