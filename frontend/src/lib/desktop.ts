/** Desktop ilova (Electron preload) beradigan ko'prik. Brauzerda mavjud emas. */
export type ToolResult = { output: string; isError: boolean };
export type OmniDesktop = {
  version: number;
  platform: string;
  pickFolder: () => Promise<{ name: string; path: string } | null>;
  tool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** v2+: faylni odatiy dasturda ochish (eski desktop versiyalarida yo'q) */
  open?: (relPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** v3+: faylni fayl menejerida ko'rsatish */
  reveal?: (relPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** v4+: AI yaratgan rasmni saqlash va papkada terminal ochish */
  saveImage?: (relPath: string, base64: string) => Promise<ToolResult>;
  openTerminal?: () => Promise<{ ok: boolean; error?: string }>;
};

declare global {
  interface Window {
    omniDesktop?: OmniDesktop;
  }
}

export const getDesktop = (): OmniDesktop | null => (typeof window !== "undefined" && window.omniDesktop) || null;
