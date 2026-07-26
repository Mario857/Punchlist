import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const sharedAlias = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: {
    resolve: {
      alias: { ...sharedAlias, '@main': resolve('src/main') },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    resolve: {
      alias: { ...sharedAlias, '@preload': resolve('src/preload') },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve('src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
});
