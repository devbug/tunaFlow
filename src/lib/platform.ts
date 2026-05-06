/**
 * Lightweight platform detection cached at module load.
 *
 * Avoids pulling in `@tauri-apps/plugin-os` (extra plugin = bundle bloat) by
 * sniffing `navigator.userAgent` once. The Tauri webview reliably surfaces a
 * "Mac" / "Macintosh" token on macOS. Any false positive is harmless — the
 * macOS-only Tauri command (`notification_send_native`) returns Err on other
 * OS, so the worst case is a single extra invoke that surfaces in the console.
 *
 * Used by `notificationStore.ts` to route macOS to the native ObjC bridge
 * (`docs/plans/nativeNotificationPlan_2026-04-29.md` Path B) while keeping
 * Windows/Linux on `tauri-plugin-notification` (zero behavior change).
 */

/**
 * Detect host OS from the webview environment.
 *
 * Resolution order (most reliable first):
 *  1. `navigator.userAgentData.platform` (modern UA-CH spec; "macOS",
 *     "Windows", "Linux" tokens). Tauri 2 webview surfaces this on Win11
 *     22H2+ and recent macOS / Linux.
 *  2. `navigator.userAgent` regex (legacy fallback). Matches "Mac" /
 *     "Macintosh" / "Win" / "Windows NT" tokens that every Tauri 2 webview
 *     should emit.
 *  3. `"other"` — neither source recognised the host. Caller is expected
 *     to render a safe default (no platform-specific branch).
 *
 * The diagnostic snapshot exposed by `detectPlatformDiagnostic()` makes the
 * decision visible to issue #264 reproduction (Windows captionbar missing).
 */
export type DetectedPlatform = "macos" | "windows" | "other";

export interface PlatformDiagnostic {
  detected: DetectedPlatform;
  source: "userAgentData" | "userAgent" | "fallback";
  userAgent: string;
  userAgentDataPlatform: string | null;
}

function snapshot(): PlatformDiagnostic {
  if (typeof navigator === "undefined") {
    return { detected: "other", source: "fallback", userAgent: "", userAgentDataPlatform: null };
  }
  const ua = navigator.userAgent || "";
  // userAgentData is gated behind secure-context + recent Chromium; treat as
  // optional. Tauri 2's webview2 surfaces it on Win11 22H2+.
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  const uaDataPlatform = uaData?.platform ?? null;
  if (uaDataPlatform) {
    if (/mac/i.test(uaDataPlatform)) {
      return { detected: "macos", source: "userAgentData", userAgent: ua, userAgentDataPlatform: uaDataPlatform };
    }
    if (/win/i.test(uaDataPlatform)) {
      return { detected: "windows", source: "userAgentData", userAgent: ua, userAgentDataPlatform: uaDataPlatform };
    }
  }
  if (/Mac|Macintosh|MacIntel/i.test(ua)) {
    return { detected: "macos", source: "userAgent", userAgent: ua, userAgentDataPlatform: uaDataPlatform };
  }
  if (/Win/i.test(ua)) {
    return { detected: "windows", source: "userAgent", userAgent: ua, userAgentDataPlatform: uaDataPlatform };
  }
  return { detected: "other", source: "fallback", userAgent: ua, userAgentDataPlatform: uaDataPlatform };
}

const cached = snapshot();

export function isMacOS(): boolean {
  return cached.detected === "macos";
}

export function isWindows(): boolean {
  return cached.detected === "windows";
}

/**
 * Returns the diagnostic snapshot computed at module load. Components can
 * `console.warn` this when issue #264 (Windows captionbar missing) is being
 * reproduced — surfaces the user-agent strings the gate actually saw.
 */
export function detectPlatformDiagnostic(): PlatformDiagnostic {
  return cached;
}
