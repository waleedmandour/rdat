import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      // Single source of truth for version: read from package.json at build
      // time and inject into the bundle. Consumed by src/i18n/translations.ts
      // so the footer string always matches package.json version.
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
