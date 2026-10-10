import { defineConfig } from 'vite';
const apiUrl = new URL('./server/api.mjs', import.meta.url).href;
async function attachApi(server) {
  const { createApiMiddleware } = await import(/* @vite-ignore */ apiUrl);
  server.middlewares.use(createApiMiddleware());
}
export default defineConfig({
  plugins: [{ name: 'launch-validation-api', configureServer: attachApi, configurePreviewServer: attachApi }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.local/**'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', rollupOptions: { input: { main: 'index.html', draws: 'draws.html', launch: 'launch.html', project: 'project.html' } } },
});
