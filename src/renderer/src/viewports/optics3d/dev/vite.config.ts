// DEV ONLY: standalone preview of the 3D optics viewport (does not touch the app's electron-vite config).
// npx vite --config src/renderer/src/viewports/optics3d/dev/vite.config.ts  -> http://localhost:5203/preview.html
import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(__dirname);
const project = resolve(__dirname, '../../../../../..');

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { '@core': resolve(project, 'src/core'), '@renderer': resolve(project, 'src/renderer/src') } },
  server: { port: 5203, strictPort: true, open: false, fs: { allow: [project] } },
});
