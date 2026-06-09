import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  // 加载 .env 文件中的环境变量
  const env = loadEnv(mode, process.cwd(), '');

  const DEEPSEEK_API_KEY = env.VITE_DEEPSEEK_API_KEY || '';
  const OPENCODE_PASSWORD = env.VITE_OPENCODE_PASSWORD || '';
  const OPENCODE_AUTH = 'Basic ' + Buffer.from(`opencode:${OPENCODE_PASSWORD}`).toString('base64');

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
        // OpenCode Server API 代理（浏览器模式走代理，避免 CORS + 注入认证）
        '/opencode-api': {
          target: 'http://127.0.0.1:4096',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/opencode-api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // 移除前端可能发来的 Authorization，统一由代理层注入
            proxyReq.removeHeader('Authorization');
            // 在代理层注入 Authorization header，浏览器不再弹出认证框
            proxyReq.setHeader('Authorization', OPENCODE_AUTH);
          });
        },
        },
        // DeepSeek API 代理（Key 在服务端注入，前端不暴露）
        '/deepseek-api': {
          target: 'https://api.deepseek.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/deepseek-api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // 在服务端注入 Authorization header
              proxyReq.setHeader('Authorization', `Bearer ${DEEPSEEK_API_KEY}`);
              // 移除前端可能传来的 Authorization header
              proxyReq.removeHeader('x-forwarded-authorization');
            });
          },
        },
      },
    },
  };
});
