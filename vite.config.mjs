import { defineConfig } from 'vite';
import {fileURLToPath} from 'node:url';
const appRoot=fileURLToPath(new URL('./apps/launch/',import.meta.url));
const workspace=fileURLToPath(new URL('./',import.meta.url));
const apiUrl = new URL('./server/api.mjs', import.meta.url).href;
async function attachApi(server) {
  const { createApiMiddleware } = await import(/* @vite-ignore */ apiUrl);
  server.middlewares.use(createApiMiddleware());
}
export default defineConfig({
  root: appRoot,
  plugins: [{ name: 'launch-validation-api', configureServer: attachApi, configurePreviewServer: attachApi }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    fs: { allow: [workspace], deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.local/**'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: fileURLToPath(new URL('./dist/',import.meta.url)), emptyOutDir: true,
    rollupOptions: { input: Object.fromEntries(['index','draws','launch','owner','project','pw-owner'].map(name=>[name,appRoot+name+'.html'])) } },
});
