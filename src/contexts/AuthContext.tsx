import React, { createContext, useContext, useEffect, useState } from 'react';
import { authService, type PublicUser } from '../services/authService';
import { syncAiPrefsFromServer } from '../config/aiConfig';

interface AuthContextValue {
  user: PublicUser | null;
  /** True while the initial session check (/me) is in-flight. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Rehydrate session from the httpOnly cookie on every page load.
  // If the cookie is absent or expired the request returns 401 and we
  // stay in the unauthenticated state.
  useEffect(() => {
    authService
      .me()
      .then(({ user: u }) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Whenever a user becomes authenticated (rehydrate, login, or register),
  // pull their server-side AI generation preferences into local storage so
  // settings follow the account across browsers. API keys stay local.
  useEffect(() => {
    if (user) {
      void syncAiPrefsFromServer().catch(() => {
        /* non-fatal — local defaults remain in effect */
      });
    }
  }, [user]);

  const login = async (email: string, password: string): Promise<void> => {
    const { user: u } = await authService.login(email, password);
    setUser(u);
  };

  const register = async (email: string, password: string): Promise<void> => {
    const { user: u } = await authService.register(email, password);
    setUser(u);
  };

  const logout = async (): Promise<void> => {
    await authService.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}
