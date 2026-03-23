import { useEffect, useState } from "react";

const STORAGE_KEY = "sciagent.sidebar.collapsed";

const readInitialState = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(STORAGE_KEY) === "true";
};

export const useSidebarCollapse = () => {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialState);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return {
    collapsed,
    setCollapsed,
    toggleCollapsed: () => setCollapsed((current) => !current),
  };
};
