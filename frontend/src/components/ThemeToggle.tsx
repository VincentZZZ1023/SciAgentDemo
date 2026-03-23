import { useTheme } from "../theme/ThemeProvider";
import { APP_COPY } from "../lib/copy";

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  const icon = theme === "dark" ? "🌙" : "☀️";
  const label = theme === "dark" ? APP_COPY.theme.dark : APP_COPY.theme.light;
  const tooltip = theme === "dark" ? APP_COPY.theme.switchToLight : APP_COPY.theme.switchToDark;

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      title={tooltip}
      aria-label={tooltip}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="theme-toggle-label">{label}</span>
    </button>
  );
};
