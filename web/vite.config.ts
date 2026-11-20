import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

const demo = process.env.VITE_DEMO === '1';
export default defineConfig({
  root: __dirname,
  plugins: [react(), ...(demo ? [viteSingleFile()] : [])],
  css: { postcss: path.resolve(__dirname, 'postcss.config.cjs') },
  define: { __DEMO__: JSON.stringify(demo) },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' }, fs: { allow: [path.resolve(__dirname, '..')] } },
  build: { outDir: demo ? path.resolve(__dirname, '../dist-demo') : path.resolve(__dirname, '../dist'), emptyOutDir: true },
});
