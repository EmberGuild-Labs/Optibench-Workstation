QA scripts for the 3D viewport (drive the dev harness over CDP).
1) npx vite --config src/renderer/src/viewports/optics3d/dev/vite.config.ts
2) node_modules/electron/dist/electron.exe --remote-debugging-port=9343 src/renderer/src/viewports/optics3d/dev/qa/open-electron.js http://localhost:5203/preview.html
3) O3D=<out dir> DOCS=docs/screenshots CDP_PORT=9343 node scripts/dev/cdp.mjs run src/renderer/src/viewports/optics3d/dev/qa/qa1.mjs
qa1: top-view orientation + X/Y/Z arrow drags stay under the cursor; qa2: yaw/pitch rings, Esc cancel, Z arrow;
qa3: click select/deselect, arrow/PageUp nudges, frame; qa5: palette drop, example sweep, doc screenshots.
