import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, tokenStore, registerAuthHandlers, errorMessage } from './api';

export interface User {
  id: number;
  email: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
  mustChangePassword: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (...codes: string[]) => boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null, loading: true,
  login: async () => { throw new Error('not ready'); },
  logout: async () => {}, refresh: async () => {}, can: () => false,
});

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) { setUser(null); setLoading(false); return; }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    registerAuthHandlers({
      unauthorized: () => {
        tokenStore.clear();
        setUser(null);
        if (!location.pathname.startsWith('/login')) navigate('/login', { replace: true });
      },
      passwordChange: () => navigate('/admin/change-password', { replace: true }),
    });
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      tokenStore.set(data.token);
      setUser(data.user);
      return data.user as User;
    } catch (err) {
      throw new Error(errorMessage(err, 'Could not sign in.'));
    }
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* session may already be gone */ }
    tokenStore.clear();
    setUser(null);
    navigate('/login', { replace: true });
  };

  const can = (...codes: string[]) => {
    if (!user) return false;
    if (user.roleCode === 'SUPER_ADMIN') return true;
    return codes.some((c) => user.permissions.includes(c));
  };

  return <Ctx.Provider value={{ user, loading, login, logout, refresh, can }}>{children}</Ctx.Provider>;
}
