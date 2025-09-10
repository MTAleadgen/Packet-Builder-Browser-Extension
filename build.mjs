import { build } from 'esbuild';
import { rm, mkdir, cp, readFile, writeFile } from 'fs/promises';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const exec = promisify(execCb);

const outDir = path.resolve('dist');

async function clean() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

async function copyStatic() {
  const files = ['manifest.json', 'popup.html', 'metadata.json'];
  for (const file of files) {
    try {
      await cp(file, path.join(outDir, file));
    } catch (err) {
      // ignore if file does not exist
    }
  }
  await cp('icons', path.join(outDir, 'icons'), { recursive: true });

  // Sanitize JSZip to avoid octal escape sequences that break in strict mode
  try {
    await mkdir(path.join(outDir, 'lib'), { recursive: true });
    const jszip = await readFile(path.join('lib', 'jszip.min.js'), 'utf8');
    const sanitized = jszip.replace(/\\([0-7]{1,3})/g, (_, oct) =>
      '\\x' + parseInt(oct, 8).toString(16).padStart(2, '0'),
    );
    await writeFile(path.join(outDir, 'lib', 'jszip.min.js'), sanitized);
  } catch (err) {
    console.warn('Skipping JSZip sanitization:', err.message);
  }
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
  });
}

async function buildStyles() {
  await exec(`npx tailwindcss -i popup.css -c tailwind.config.js -o ${path.join(outDir, 'popup.css')} --minify`);
}

await clean();
await buildScripts();
await buildStyles();
await copyStatic();
