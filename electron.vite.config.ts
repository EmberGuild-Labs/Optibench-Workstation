import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { resolve: { alias: { '@core': resolve('src/core') } } },
  preload: {},
  renderer: {
    resolve: { alias: { '@core': resolve('src/core'), '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
