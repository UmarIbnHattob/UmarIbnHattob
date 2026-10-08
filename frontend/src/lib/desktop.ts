/** Desktop ilova (Electron preload) beradigan ko'prik. Brauzerda mavjud emas. */
export type ToolResult = { output: string; isError: boolean };
export type OmniDesktop = {
  version: number;
  platform: string;
  pickFolder: () => Promise<{ name: string; path: string } | null>;
  tool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
};

declare global {
  interface Window {
    omniDesktop?: OmniDesktop;
  }
}

export const getDesktop = (): OmniDesktop | null => (typeof window !== "undefined" && window.omniDesktop) || null;
