import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@fca/agent':   path.resolve(__dirname, '../../packages/agent/index.js'),
      '@fca/tools':   path.resolve(__dirname, '../../packages/tools/index.js'),
      '@fca/prompts': path.resolve(__dirname, '../../packages/prompts/index.js'),
    }
  }
});
