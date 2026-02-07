import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react-flush-observer': path.resolve(__dirname, '../dist/index.js'),
    },
  },
  optimizeDeps: {
    include: ['react-flush-observer'],
  },
  build: {
    commonjsOptions: {
      include: [/react-flush-observer/, /node_modules/],
    },
  },
});
