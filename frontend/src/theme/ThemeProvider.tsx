import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type Theme = "light" | "dark";

const THEME_KEY = "theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

interface ThemeBootstrap {
  theme: Theme;
  userOverride: boolean;
}

const isTheme = (value: string | null): value is Theme => {
  return value === "light" || value === "dark";
};

const resolveInitialTheme = (): ThemeBootstrap => {
  if (typeof window === "undefined") {
    return { theme: "light", userOverride: false };
  }

  const stored = localStorage.getItem(THEME_KEY);
  if (isTheme(stored)) {
    return { theme: stored, userOverride: true };
  }

  const prefersDark = window.matchMedia(MEDIA_QUERY).matches;
  return {
    theme: prefersDark ? "dark" : "light",
    userOverride: false,
  };
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  const bootstrap = useMemo(resolveInitialTheme, []);
  const [theme, setTheme] = useState<Theme>(bootstrap.theme);
  const [userOverride, setUserOverride] = useState<boolean>(bootstrap.userOverride);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (userOverride) {
      localStorage.setItem(THEME_KEY, theme);
    } else {
      localStorage.removeItem(THEME_KEY);
    }
  }, [theme, userOverride]);

  useEffect(() => {
    if (typeof window === "undefined" || userOverride) {
      return;
    }

    const mediaQuery = window.matchMedia(MEDIA_QUERY);

    const handleChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? "dark" : "light");
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [userOverride]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
    setUserOverride(true);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme,
    }),
    [theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
};
