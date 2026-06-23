#!/usr/bin/env node
/**
 * OBS Auto Scene Switcher — CLI for multi-pair trading streams.
 *
 * Usage:
 *   node obs-scene.mjs list
 *   node obs-scene.mjs goto EURUSD
 *   node obs-scene.mjs next | prev
 *   node obs-scene.mjs validate
 *   node obs-scene.mjs rotate [--interval 45]
 */
import process from 'node:process';
import {
  configPath,
  loadConfig,
  gotoAlias,
  listScenes,
  validateConfig,
  stepRotate,
  runRotateLoop,
  rotatePool,
} from '../lib/switcher.mjs';

function usage() {
  console.log(`OBS Auto Scene Switcher

Commands:
  list                 List OBS scenes + current program scene
  validate             Verify config scene names exist in OBS
  goto <ALIAS>         Switch to pair (EURUSD, XAU, BTC, MANUAL, …)
  next | prev          Step rotation (skips manual unless configured)
  rotate [--interval N] Auto-rotate like Auto Scene Switcher (Ctrl+C to stop)
  help

Env:
  OBS_SCENE_CONFIG     Path to config.json (default: ./config.json)

Setup:
  1. OBS → Tools → WebSocket Server Settings → Enable (note port + password)
  2. Copy config.example.json → config.json
  3. Set obsScene to match your OBS scene names exactly
`);
}

function parseArgs(argv) {
  const out = { cmd: argv[0] || 'help', rest: [], flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' && argv[i + 1]) {
      out.flags.config = argv[++i];
    } else if (a === '--interval' && argv[i + 1]) {
      out.flags.interval = Number(argv[++i]);
    } else {
      out.rest.push(a);
    }
  }
  return out;
}

async function main() {
  const { cmd, rest, flags } = parseArgs(process.argv.slice(2));
  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    usage();
    return;
  }

  const cfg = loadConfig(configPath(flags.config));

  switch (cmd) {
    case 'list': {
      const { names, current } = await listScenes(cfg);
      console.log(`Current: ${current || '(unknown)'}`);
      console.log('OBS scenes:');
      for (const n of names) console.log(`  - ${n}`);
      console.log('\nConfigured aliases:');
      for (const s of cfg.scenes) console.log(`  ${s.alias.padEnd(8)} → ${s.obsScene}`);
      return;
    }
    case 'validate': {
      const report = await validateConfig(cfg);
      if (report.ok) {
        console.log(`OK — all ${cfg.scenes.length} configured scenes found in OBS`);
        console.log(`Current program scene: ${report.current}`);
        return;
      }
      console.error('MISSING scenes in OBS (create or fix config.obsScene):');
      for (const s of report.missing) {
        console.error(`  ${s.alias} → "${s.obsScene}" not found`);
      }
      process.exitCode = 1;
      return;
    }
    case 'goto': {
      const key = rest[0];
      if (!key) throw new Error('usage: goto <ALIAS>');
      const res = await gotoAlias(cfg, key);
      console.log(`Switched to ${res.scene.alias} (${res.obsScene})`);
      return;
    }
    case 'next':
    case 'prev': {
      const res = await stepRotate(cfg, cmd);
      console.log(`${res.alias}: ${res.from || '—'} → ${res.to}`);
      return;
    }
    case 'rotate': {
      const pool = rotatePool(cfg);
      const interval = flags.interval || cfg.rotateIntervalSec;
      console.log(
        `Auto-rotating ${pool.length} scene(s) every ${interval}s (manual ${cfg.includeManualInRotate ? 'included' : 'excluded'})`
      );
      const ac = new AbortController();
      process.on('SIGINT', () => ac.abort());
      process.on('SIGTERM', () => ac.abort());
      try {
        await runRotateLoop(cfg, {
          intervalSec: interval,
          signal: ac.signal,
          onSwitch: ({ alias, from, to, reason }) => {
            const tag = reason === 'init' ? 'start' : 'rotate';
            console.log(`[${tag}] ${alias}: ${from || '—'} → ${to}`);
          },
        });
      } catch (e) {
        if (e.message !== 'aborted') throw e;
        console.log('Stopped.');
      }
      return;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
