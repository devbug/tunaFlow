// Custom font settings — 영역별 (chat / code block / sidebar) size + family.
// Plan: docs/plans/customFontSettingsPlan_2026-05-12.md
//
// Why a dedicated store (not chatStore slice):
//  - fontSettings 는 reactive UI 갱신이 필요 (AppShell 의 CSS variable injection +
//    영역별 inline style consumer). appStore (Tauri plugin store) 는 reactive
//    subscribe 가 안 되므로, Zustand 로 in-memory 캐싱 + appStore 로 영속.
//  - chatStore 의 다른 slice 와 결합도가 0 (independent). 별 store 가 적절.
//
// INV-CFS-1: defaults 보존 — fontSettings 미설정 사용자는 현재와 동일 렌더링.
// INV-CFS-2: size clamp [10, 24] 정수 step 1. min 미만 / max 초과 / NaN → default.
// INV-CFS-3: family 빈 값 → CSS variable 폴백 chain (var(--tf-default-sans/mono)).
// INV-CFS-4: 3 영역 별도 키. 한 영역 변경이 다른 영역에 안 새어나감.
// INV-CFS-5: 변경 즉시 반영 (AppShell useEffect 로 CSS variable 동기화).

import { create } from "zustand";
import { getSetting, setSetting } from "@/lib/appStore";

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

export interface FontSettings {
  chatSize: number;
  chatFamily: string;
  codeSize: number;
  codeFamily: string;
  uiSize: number;
  uiFamily: string;
}

export const DEFAULT_FONT_SETTINGS: FontSettings = {
  chatSize: 14,
  chatFamily: "",
  codeSize: 13,
  codeFamily: "",
  uiSize: 13,
  uiFamily: "",
};

/** Clamp a font size to [FONT_SIZE_MIN, FONT_SIZE_MAX] integers. NaN / non-finite → default. */
export function clampFontSize(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded < FONT_SIZE_MIN) return FONT_SIZE_MIN;
  if (rounded > FONT_SIZE_MAX) return FONT_SIZE_MAX;
  return rounded;
}

/** Sanitize a persisted blob into a fully populated FontSettings. */
export function normalizeFontSettings(input: Partial<FontSettings> | null | undefined): FontSettings {
  const src = input ?? {};
  return {
    chatSize: clampFontSize(src.chatSize, DEFAULT_FONT_SETTINGS.chatSize),
    chatFamily: typeof src.chatFamily === "string" ? src.chatFamily : DEFAULT_FONT_SETTINGS.chatFamily,
    codeSize: clampFontSize(src.codeSize, DEFAULT_FONT_SETTINGS.codeSize),
    codeFamily: typeof src.codeFamily === "string" ? src.codeFamily : DEFAULT_FONT_SETTINGS.codeFamily,
    uiSize: clampFontSize(src.uiSize, DEFAULT_FONT_SETTINGS.uiSize),
    uiFamily: typeof src.uiFamily === "string" ? src.uiFamily : DEFAULT_FONT_SETTINGS.uiFamily,
  };
}

interface FontSettingsStore {
  settings: FontSettings;
  loaded: boolean;
  /** Load persisted fontSettings from appStore. Idempotent. */
  load: () => Promise<void>;
  /** Patch one or more fields. size fields are clamped. Persisted to appStore. */
  update: (patch: Partial<FontSettings>) => void;
  /** Reset all fields to default. Persisted. */
  reset: () => void;
}

export const useFontSettingsStore = create<FontSettingsStore>((set, get) => ({
  settings: DEFAULT_FONT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const raw = await getSetting<Partial<FontSettings> | null>("fontSettings", null);
      const normalized = normalizeFontSettings(raw);
      set({ settings: normalized, loaded: true });
    } catch (e) {
      console.warn("[fontSettings] load failed, using defaults:", e);
      set({ settings: DEFAULT_FONT_SETTINGS, loaded: true });
    }
  },
  update: (patch) => {
    const current = get().settings;
    const next: FontSettings = {
      ...current,
      ...patch,
      // Re-apply clamp on any size field overlap to guard against UI bypass.
      chatSize: patch.chatSize !== undefined ? clampFontSize(patch.chatSize, current.chatSize) : current.chatSize,
      codeSize: patch.codeSize !== undefined ? clampFontSize(patch.codeSize, current.codeSize) : current.codeSize,
      uiSize: patch.uiSize !== undefined ? clampFontSize(patch.uiSize, current.uiSize) : current.uiSize,
    };
    set({ settings: next });
    // Fire-and-forget persistence (appStore autoSave handles flush).
    setSetting("fontSettings", next).catch((e) => console.error("[fontSettings] persist failed:", e));
  },
  reset: () => {
    set({ settings: DEFAULT_FONT_SETTINGS });
    setSetting("fontSettings", DEFAULT_FONT_SETTINGS).catch((e) =>
      console.error("[fontSettings] reset persist failed:", e),
    );
  },
}));
