import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  envDir: path.resolve(__dirname, '../../'),
  server: {
    proxy: {
      '/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/anthropic/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('origin'); });
        }
      },
      '/proxy/cms': {
        target: 'https://npiregistry.cms.hhs.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/cms/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('origin'); });
        }
      },
      '/proxy/opencorporates': {
        target: 'https://api.opencorporates.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/opencorporates/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('origin'); });
        }
      },
      '/proxy/opensanctions': {
        target: 'https://api.opensanctions.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/opensanctions/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('origin'); });
        }
      },
      '/proxy/registrylookup': {
        target: 'https://api.registry-lookup.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/registrylookup/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('origin'); });
        }
      },
      '/proxy/gleif': {
        target: 'https://api.gleif.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/gleif/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('origin'); });
        }
      }
    }
  },
  resolve: {
    alias: {
      '@fca/agent':   path.resolve(__dirname, '../../packages/agent/index.js'),
      '@fca/tools':   path.resolve(__dirname, '../../packages/tools/index.js'),
      '@fca/prompts': path.resolve(__dirname, '../../packages/prompts/index.js'),
    }
  }
});
