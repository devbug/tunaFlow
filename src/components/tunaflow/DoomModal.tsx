import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Open DOOM in a separate Tauri WebView window.
 * Fully isolated from main app — no CSP/CORS/bundle conflicts.
 */
export async function openDoom() {
  // Check if already open
  const existing = await WebviewWindow.getByLabel("doom").catch(() => null);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const doom = new WebviewWindow("doom", {
    title: "🔴 DOOM — tunaFlow Easter Egg",
    url: "/doom.html",
    width: 960,
    height: 720,
    center: true,
    resizable: true,
    decorations: true,
  });

  doom.once("tauri://error", (e) => {
    console.error("[doom] window error:", e);
  });
}
