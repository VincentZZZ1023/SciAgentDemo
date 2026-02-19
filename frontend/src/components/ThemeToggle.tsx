import { useTheme } from "../theme/ThemeProvider";

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  const icon = theme === "dark" ? "🌙" : "☀️";
  const label = theme === "dark" ? "Dark" : "Light";
  const tooltip = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

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
