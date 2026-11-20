#!/usr/bin/env node
/**
 * Optibench Workstation project tool — launcher.
 *
 *   node scripts/obw.mjs <command> [...args]      (run `node scripts/obw.mjs help`)
 *
 * The engines are TypeScript (src/core) and the tool itself lives in scripts/obw-cli.ts. Node cannot
 * run them directly (extension-less imports, non-type-only type imports), so this launcher bundles
 * scripts/obw-cli.ts with rolldown (already installed as a dependency of vite) into
 * node_modules/.cache/obw/obw.bundle.mjs and runs it. The bundle is rebuilt whenever any source
 * file under scripts/ or src/core/ is newer than it.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'scripts', 'obw-cli.ts');
const outDir = join(root, 'node_modules', '.cache', 'obw');
const outFile = join(outDir, 'obw.bundle.mjs');

function newestMtime(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) t = Math.max(t, newestMtime(p));
    else if (/\.(ts|mjs|js)$/.test(e.name)) t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
}

async function ensureBundle() {
  const srcT = Math.max(newestMtime(join(root, 'src', 'core')), statSync(entry).mtimeMs, statSync(fileURLToPath(import.meta.url)).mtimeMs);
  if (existsSync(outFile) && statSync(outFile).mtimeMs >= srcT && !process.env.OBW_REBUILD) return;
  mkdirSync(outDir, { recursive: true });
  let rolldown;
  try {
    rolldown = await import('rolldown');
  } catch {
    console.error('obw: cannot load "rolldown" (it ships with vite). Run `npm install` first.');
    process.exit(2);
  }
  const bundle = await rolldown.rolldown({ input: entry, platform: 'node', logLevel: 'silent' });
  await bundle.write({ file: outFile, format: 'esm' });
  await bundle.close();
}

await ensureBundle();
const mod = await import(pathToFileURL(outFile).href + `?t=${statSync(outFile).mtimeMs}`);
const code = await mod.main(process.argv.slice(2));
process.exitCode = typeof code === 'number' ? code : 0;
