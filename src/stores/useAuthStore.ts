import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 用户信息 */
interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  plan: string;
}

/** 认证状态 */
interface AuthState {
  /** 是否已登录 */
  isAuthenticated: boolean;
  /** 当前用户 */
  user: AuthUser | null;
  /** Access Token (JWT) */
  accessToken: string | null;
  /** Refresh Token */
  refreshToken: string | null;
  /** 云端服务器地址 */
  serverUrl: string;
  /** 登录加载状态 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;

  // ===== 操作方法 =====
  /** 设置服务器地址 */
  setServerUrl: (url: string) => void;
  /** 注册 */
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  /** 登录 */
  login: (email: string, password: string) => Promise<void>;
  /** 刷新 token */
  refreshAccessToken: () => Promise<void>;
  /** 登出 */
  logout: () => void;
  /** 清除错误 */
  clearError: () => void;
  /** 获取带 Bearer 前缀的 token */
  getAuthHeader: () => Record<string, string>;
  /** 获取 WebSocket 连接 URL (带 token) */
  getWsUrl: (basePath?: string) => string;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      serverUrl: localStorage.getItem('cloud_server_url') || 'http://localhost:80',
      isLoading: false,
      error: null,

      setServerUrl: (url: string) => {
        const cleanUrl = url.replace(/\/+$/, '');
        localStorage.setItem('cloud_server_url', cleanUrl);
        set({ serverUrl: cleanUrl });
      },

      register: async (email: string, password: string, displayName?: string) => {
        set({ isLoading: true, error: null });
        try {
          const { serverUrl } = get();
          const res = await fetch(`${serverUrl}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, displayName }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Registration failed');
          }

          set({
            isAuthenticated: true,
            user: data.user,
            accessToken: data.access_token,
            refreshToken: data.refresh_token || null,
            isLoading: false,
          });
        } catch (e: any) {
          set({ isLoading: false, error: e.message });
          throw e;
        }
      },

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const { serverUrl } = get();
          const res = await fetch(`${serverUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Login failed');
          }

          set({
            isAuthenticated: true,
            user: data.user,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            isLoading: false,
          });
        } catch (e: any) {
          set({ isLoading: false, error: e.message });
          throw e;
        }
      },

      refreshAccessToken: async () => {
        const { refreshToken, serverUrl } = get();
        if (!refreshToken) {
          get().logout();
          return;
        }

        try {
          const res = await fetch(`${serverUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });

          const data = await res.json();
          if (!res.ok) {
            get().logout();
            return;
          }

          set({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
          });
        } catch {
          get().logout();
        }
      },

      logout: () => {
        set({
          isAuthenticated: false,
          user: null,
          accessToken: null,
          refreshToken: null,
          error: null,
        });
      },

      clearError: () => set({ error: null }),

      getAuthHeader: () => {
        const { accessToken } = get();
        if (!accessToken) return {};
        return { Authorization: `Bearer ${accessToken}` };
      },

      getWsUrl: (basePath = '/ws') => {
        const { serverUrl, accessToken } = get();
        const wsBase = serverUrl.replace(/^http/, 'ws');
        const separator = basePath.includes('?') ? '&' : '?';
        return `${wsBase}${basePath}${accessToken ? `${separator}token=${accessToken}` : ''}`;
      },
    }),
    {
      name: 'pvf-auth-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        serverUrl: state.serverUrl,
      }),
    }
  )
);
