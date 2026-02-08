import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    sourcemapIgnoreList: () => false,
  },
  resolve: {
    alias: {
      'react-flush-observer': path.resolve(__dirname, '../src/index.ts'),
    },
  },
});
