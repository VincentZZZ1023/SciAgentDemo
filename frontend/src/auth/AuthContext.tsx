import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  clearAccessToken,
  getAccessToken,
  getAuthMe,
  login as apiLogin,
  register as apiRegister,
  setAccessToken,
} from "../api/client";

export type AuthRole = "user" | "admin";

export interface AuthUser {
  username: string;
  role: AuthRole;
}

interface RegisterInput {
  username?: string;
  email?: string;
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  checking: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  refreshUser: () => Promise<AuthUser | null>;
  logout: () => void;
  switchAccount: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const normalizeRole = (role: string | undefined): AuthRole => {
  return role === "admin" ? "admin" : "user";
};

const normalizeUsername = (username: string | undefined): string => {
  const trimmed = (username ?? "").trim();
  return trimmed || "user";
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState<string | null>(() => getAccessToken());

  const logout = useCallback(() => {
    clearAccessToken();
    setToken(null);
    setUser(null);
    setChecking(false);
  }, []);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    const existingToken = getAccessToken();
    if (!existingToken) {
      setToken(null);
      setUser(null);
      return null;
    }

    try {
      const me = await getAuthMe();
      const resolved: AuthUser = {
        username: normalizeUsername(me.username),
        role: normalizeRole(me.role),
      };
      setToken(existingToken);
      setUser(resolved);
      return resolved;
    } catch {
      clearAccessToken();
      setToken(null);
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setChecking(true);
      const resolved = await refreshUser();
      if (!cancelled) {
        setChecking(false);
        if (!resolved) {
          setUser(null);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  const login = useCallback(async (username: string, password: string): Promise<AuthUser> => {
    const response = await apiLogin(username, password);
    setAccessToken(response.access_token);
    setToken(response.access_token);

    const resolved: AuthUser = {
      username: normalizeUsername(username),
      role: normalizeRole(response.role),
    };

    setUser(resolved);

    const me = await refreshUser();
    return me ?? resolved;
  }, [refreshUser]);

  const register = useCallback(async (input: RegisterInput): Promise<AuthUser> => {
    const response = await apiRegister(input);
    setAccessToken(response.access_token);
    setToken(response.access_token);

    const resolvedUsername = normalizeUsername(input.username ?? input.email);
    const resolved: AuthUser = {
      username: resolvedUsername,
      role: normalizeRole(response.role),
    };

    setUser(resolved);

    const me = await refreshUser();
    return me ?? resolved;
  }, [refreshUser]);

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      token,
      checking,
      isAuthenticated: Boolean(user && token),
      isAdmin: user?.role === "admin",
      login,
      register,
      refreshUser,
      logout,
      switchAccount: logout,
    };
  }, [checking, login, logout, refreshUser, register, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
};
