// Dev harness for the circuit viewport: npx vite --config src/renderer/src/viewports/circuit/dev/vite.config.mjs
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
export default defineConfig({
  root: here,
  resolve: { alias: { '@core': resolve(root, 'src/core'), '@renderer': resolve(root, 'src/renderer/src') } },
  plugins: [react(), {
    // dev-only: POST a PNG data URL to /__snap to save a canvas capture (for headless checks)
    name: 'snap',
    configureServer(server) {
      server.middlewares.use('/__snap', (req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const out = process.env.SNAP_OUT || resolve(tmpdir(), 'circuit-snap.png');
          writeFileSync(out, Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64'));
          res.end(out);
        });
      });
    }
  }],
  server: { port: 5287, strictPort: true, fs: { allow: [root] } }
});
