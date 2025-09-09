import { build } from 'esbuild';
import { rm, mkdir, cp } from 'fs/promises';
import path from 'path';

const outDir = path.resolve('dist');

async function clean() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

async function copyStatic() {
  const files = ['manifest.json', 'popup.html', 'index.html', 'metadata.json'];
  for (const file of files) {
    try {
      await cp(file, path.join(outDir, file));
    } catch (err) {
      // ignore if file does not exist
    }
  }
  await cp('icons', path.join(outDir, 'icons'), { recursive: true });
}

async function buildScripts() {
  await build({
    entryPoints: ['background.ts', 'content.ts'],
    outdir: outDir,
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    sourcemap: true,
  });

  await build({
    entryPoints: ['popup.tsx'],
    outdir: outDir,
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    sourcemap: true,
    external: ['react', 'react-dom', 'react-dom/client'],
  });
}

await clean();
await buildScripts();
await copyStatic();
