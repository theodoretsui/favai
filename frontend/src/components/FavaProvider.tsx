import { useEffect, useState, type ReactNode } from "react";
import { XProvider } from "@ant-design/x";
import { App as AntApp, theme as antTheme, type ThemeConfig } from "antd";

const LIGHT_COLORS = {
  background: "#ffffff",
  border: "#ebebeb",
  foreground: "#252525",
  muted: "#f7f7f7",
  mutedForeground: "#737373",
  primary: "#006ca8",
  primaryActive: "#005483",
  primaryHover: "#007fbd",
};

const DARK_COLORS = {
  background: "#262626",
  border: "#4d4d4d",
  foreground: "#cccccc",
  muted: "#333333",
  mutedForeground: "#a6a6a6",
  primary: "#5cc0ff",
  primaryActive: "#3faeea",
  primaryHover: "#75c9ff",
};

function getRoot() {
  return document.querySelector<HTMLElement>(".favai-root") ?? document.body;
}

export function FavaProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() =>
    getRoot().classList.contains("dark"),
  );

  useEffect(() => {
    const root = getRoot();
    const syncTheme = () => setIsDark(root.classList.contains("dark"));
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  const theme: ThemeConfig = {
    algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: colors.primary,
      colorPrimaryActive: colors.primaryActive,
      colorPrimaryHover: colors.primaryHover,
      colorInfo: colors.primary,
      colorText: colors.foreground,
      colorTextSecondary: colors.mutedForeground,
      colorTextPlaceholder: colors.mutedForeground,
      colorBgBase: colors.background,
      colorBgContainer: colors.background,
      colorBgElevated: colors.background,
      colorFillSecondary: colors.muted,
      colorBorder: colors.border,
      colorBorderSecondary: colors.border,
      borderRadius: 2,
      borderRadiusLG: 4,
      borderRadiusSM: 2,
      controlHeight: 32,
      controlHeightSM: 28,
      fontFamily: "inherit",
      fontSize: 14,
    },
    components: {
      Button: { borderRadius: 3 },
      Card: { borderRadiusLG: 4 },
      Modal: { borderRadiusLG: 4 },
      Table: { headerBg: colors.muted },
    },
  };

  return (
    <XProvider
      prefixCls="favai"
      iconPrefixCls="favai-icon"
      getPopupContainer={getRoot}
      theme={theme}
    >
      <AntApp message={{ maxCount: 4 }} notification={{ maxCount: 4 }}>
        {children}
      </AntApp>
    </XProvider>
  );
}
