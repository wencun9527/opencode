import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  // 加载 .env 文件中的环境变量
  const env = loadEnv(mode, process.cwd(), '');

  const OPENCODE_PASSWORD = env.VITE_OPENCODE_PASSWORD || 'opencode2026';
  const OPENCODE_AUTH = 'Basic ' + Buffer.from(`opencode:${OPENCODE_PASSWORD}`).toString('base64');
  const OPENCODE_REMOTE_URL = env.VITE_OPENCODE_REMOTE_URL || 'http://1.12.207.131:4096';

  return {
    plugins: [tailwindcss(), react()],
    // Tauri V2 配置
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
      // 代理配置
      proxy: {
        // PVFut API 代理
        '/pvfut-api': {
          target: 'http://localhost:27000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/pvfut-api/, ''),
        },
        // OpenCode Server API 代理（指向远程云端服务器）
        '/opencode-api': {
          target: OPENCODE_REMOTE_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/opencode-api/, ''),
          headers: {
            Authorization: OPENCODE_AUTH,
          },
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              console.log('[Proxy]', req.method, req.url, '→', proxyReq.path, 'Auth:', proxyReq.getHeader('Authorization') ? 'YES' : 'NO');
              if (!proxyReq.getHeader('Authorization')) {
                proxyReq.setHeader('Authorization', OPENCODE_AUTH);
              }
            });
            proxy.on('error', (err, _req, res) => {
              console.error('[Proxy Error]', err.message);
              if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
              }
              res.end('Proxy Error: ' + err.message);
            });
          },
        },
        // Relay 认证/管理 API 代理
        '/auth': {
          target: env.VITE_RELAY_URL || 'http://1.12.207.131:9100',
          changeOrigin: true,
        },
        '/admin': {
          target: env.VITE_RELAY_URL || 'http://1.12.207.131:9100',
          changeOrigin: true,
        },
        '/health': {
          target: env.VITE_RELAY_URL || 'http://1.12.207.131:9100',
          changeOrigin: true,
        },
      },
    },
  };
});
