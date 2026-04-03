import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs/promises';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  
  return {
    plugins: [
      react(), 
      tailwindcss(),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          path.join(process.cwd(), 'models'),
          path.join(process.cwd(), 'models', '**'),
          path.join(process.cwd(), 'saves'),
          path.join(process.cwd(), 'saves', '**'),
          path.join(process.cwd(), 'game'),
          path.join(process.cwd(), 'game', '**'),
          path.join(process.cwd(), 'dist'),
          path.join(process.cwd(), 'dist', '**'),
          path.join(process.cwd(), 'node_modules'),
          path.join(process.cwd(), 'node_modules', '**'),
          '**/*.gguf',
          '**/*.bin',
          '**/*.json'
        ],
      },
    },
  };
});
