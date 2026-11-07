import { defineConfig, type Plugin } from 'vitest/config';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Minifies GLSL inside template literals marked with a leading glsl comment (build only). */
function glslMinify(): Plugin {
  const re = /\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`/g;
  return {
    name: 'glsl-minify',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || !code.includes('glsl')) return null;
      const out = code.replace(re, (_m, body: string) => {
        const lines = body
          .split('\n')
          .map((l) => l.replace(/\/\/.*$/, '').trim())
          .filter((l) => l.length > 0);
        // join non-preprocessor lines to save bytes, keep newline after directives
        let s = '';
        for (const l of lines) {
          if (l.startsWith('#')) s += (s.length && !s.endsWith('\n') ? '\n' : '') + l + '\n';
          else s += l.replace(/\s+/g, ' ').replace(/\s*([{}();,=+\-*/<>?:&|!])\s*/g, '$1') + ' ';
        }
        return '`' + s.trim() + '`';
      });
      return { code: out, map: null };
    },
  };
}

/** Emits sw.js with the full precache list and a content-derived version (build only). */
function pwaPlugin(): Plugin {
  return {
    name: 'null-arena-pwa',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      const statics = ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
      const h = createHash('sha256');
      for (const f of files.sort()) {
        const c = bundle[f]!;
        h.update(f);
        h.update(c.type === 'chunk' ? c.code : typeof c.source === 'string' ? c.source : Buffer.from(c.source));
      }
      const version = h.digest('hex').slice(0, 10);
      const precache = ['./', ...files.filter((f) => f !== 'index.html'), ...statics];
      const tpl = readFileSync(resolve(import.meta.dirname, 'tools/sw-template.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)),
      });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, date: new Date().toISOString() }) });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [glslMinify(), pwaPlugin()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  css: {
    transformer: 'lightningcss',
    lightningcss: { targets: { chrome: 110 << 16, firefox: 115 << 16, safari: 16 << 16 } },
  },
  define: {
    __DEV__: JSON.stringify(command === 'serve' || process.env['NULL_DEBUG'] === '1'),
  },
  build: {
    target: 'es2022',
    minify: 'terser',
    cssMinify: 'lightningcss',
    sourcemap: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 900,
    terserOptions: {
      ecma: 2020,
      module: true,
      // no unsafe_math (float reassociation would break determinism), no unsafe_arrows (breaks constructors)
      compress: { passes: 3, drop_console: true, toplevel: true },
      mangle: { toplevel: true },
      format: { comments: false },
    },
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), lab: resolve(import.meta.dirname, 'lab.html'), kit: resolve(import.meta.dirname, 'kit.html'), train: resolve(import.meta.dirname, 'train.html') },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    execArgv: ['--expose-gc'],
  },
}));
