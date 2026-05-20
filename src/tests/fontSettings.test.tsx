// Custom font settings — T5 coverage.
// Plan: docs/plans/customFontSettingsPlan_2026-05-12.md §3 T5
//
// Scope:
//  - T1 setter clamp [10, 24] (under / over / NaN / non-integer → default).
//  - T1 store update / reset 영속 호출 확인 (setSetting mock).
//  - T2 AppearanceSection UI: input 입력 → debounce 후 store 갱신.
//  - T3 applyFontVariables: CSS variable 6 개 root style 에 정확히 반영.
//    family 빈 값 → removeProperty 로 default 회복.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

// react-i18next: identity mock — assertions go against keys.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "ko", changeLanguage: () => Promise.resolve() },
  }),
}));

// appStore: in-memory persistence stub. setSetting 캡처해 영속 호출 검증.
const mockSetSetting = vi.fn<(...a: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockGetSetting = vi.fn<(...a: unknown[]) => Promise<unknown>>((_key, fallback) =>
  Promise.resolve(fallback),
);
vi.mock("@/lib/appStore", () => ({
  getSetting: (key: string, fallback: unknown) => mockGetSetting(key, fallback),
  setSetting: (key: string, value: unknown) => mockSetSetting(key, value),
}));

import {
  useFontSettingsStore,
  clampFontSize,
  normalizeFontSettings,
  DEFAULT_FONT_SETTINGS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
} from "@/stores/fontSettingsStore";
import { applyFontVariables } from "@/lib/fontVariables";
import { AppearanceSection } from "@/components/tunaflow/settings/AppearanceSection";

beforeEach(() => {
  mockSetSetting.mockClear();
  mockGetSetting.mockClear();
  // Reset Zustand store between tests.
  useFontSettingsStore.setState({ settings: DEFAULT_FONT_SETTINGS, loaded: false });
});

describe("fontSettings — T1 clamp logic", () => {
  it("clamps values below minimum to minimum", () => {
    expect(clampFontSize(5, 14)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(0, 14)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(-100, 14)).toBe(FONT_SIZE_MIN);
  });

  it("clamps values above maximum to maximum", () => {
    expect(clampFontSize(30, 14)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(1000, 14)).toBe(FONT_SIZE_MAX);
  });

  it("passes through valid integers in range", () => {
    expect(clampFontSize(10, 14)).toBe(10);
    expect(clampFontSize(14, 14)).toBe(14);
    expect(clampFontSize(24, 14)).toBe(24);
  });

  it("rounds non-integer values", () => {
    expect(clampFontSize(13.7, 14)).toBe(14);
    expect(clampFontSize(11.2, 14)).toBe(11);
  });

  it("returns fallback for NaN / non-finite", () => {
    expect(clampFontSize(NaN, 14)).toBe(14);
    expect(clampFontSize(Infinity, 13)).toBe(13);
    expect(clampFontSize(-Infinity, 13)).toBe(13);
    expect(clampFontSize("not a number", 13)).toBe(13);
  });

  it("accepts numeric strings via Number coercion", () => {
    expect(clampFontSize("16", 14)).toBe(16);
    expect(clampFontSize("99", 14)).toBe(FONT_SIZE_MAX);
  });
});

describe("fontSettings — T1 normalizeFontSettings", () => {
  it("returns full defaults on null / undefined input", () => {
    expect(normalizeFontSettings(null)).toEqual(DEFAULT_FONT_SETTINGS);
    expect(normalizeFontSettings(undefined)).toEqual(DEFAULT_FONT_SETTINGS);
  });

  it("preserves valid fields and falls back for missing ones", () => {
    const partial = { chatSize: 18, chatFamily: "'Roboto', sans-serif" };
    const result = normalizeFontSettings(partial);
    expect(result.chatSize).toBe(18);
    expect(result.chatFamily).toBe("'Roboto', sans-serif");
    expect(result.codeSize).toBe(DEFAULT_FONT_SETTINGS.codeSize);
    expect(result.uiFamily).toBe(DEFAULT_FONT_SETTINGS.uiFamily);
  });

  it("clamps out-of-range size fields", () => {
    const corrupted = { chatSize: 50, codeSize: -5, uiSize: 14 };
    const result = normalizeFontSettings(corrupted);
    expect(result.chatSize).toBe(FONT_SIZE_MAX);
    expect(result.codeSize).toBe(FONT_SIZE_MIN);
    expect(result.uiSize).toBe(14);
  });
});

describe("fontSettings — T1 store update", () => {
  it("clamps on update and persists via appStore", () => {
    useFontSettingsStore.getState().update({ chatSize: 999 });
    expect(useFontSettingsStore.getState().settings.chatSize).toBe(FONT_SIZE_MAX);
    expect(mockSetSetting).toHaveBeenCalledWith(
      "fontSettings",
      expect.objectContaining({ chatSize: FONT_SIZE_MAX }),
    );
  });

  it("allows multi-field patch without touching other regions", () => {
    useFontSettingsStore.getState().update({ codeSize: 16, codeFamily: "'Fira Code', monospace" });
    const s = useFontSettingsStore.getState().settings;
    expect(s.codeSize).toBe(16);
    expect(s.codeFamily).toBe("'Fira Code', monospace");
    expect(s.chatSize).toBe(DEFAULT_FONT_SETTINGS.chatSize);
    expect(s.uiFamily).toBe(DEFAULT_FONT_SETTINGS.uiFamily);
  });

  it("reset restores defaults and persists", () => {
    useFontSettingsStore.getState().update({ chatSize: 20, uiFamily: "'Test', sans-serif" });
    useFontSettingsStore.getState().reset();
    expect(useFontSettingsStore.getState().settings).toEqual(DEFAULT_FONT_SETTINGS);
    expect(mockSetSetting).toHaveBeenLastCalledWith("fontSettings", DEFAULT_FONT_SETTINGS);
  });
});

describe("fontSettings — T3 applyFontVariables (CSS injection)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
  });

  afterEach(() => {
    root.remove();
  });

  it("sets all 3 size variables in px", () => {
    applyFontVariables(
      { chatSize: 16, chatFamily: "", codeSize: 12, codeFamily: "", uiSize: 11, uiFamily: "" },
      root,
    );
    expect(root.style.getPropertyValue("--tf-chat-size")).toBe("16px");
    expect(root.style.getPropertyValue("--tf-code-size")).toBe("12px");
    expect(root.style.getPropertyValue("--tf-ui-size")).toBe("11px");
  });

  it("sets family variables for non-empty values", () => {
    applyFontVariables(
      {
        chatSize: 14,
        chatFamily: "'Inter', sans-serif",
        codeSize: 13,
        codeFamily: "'JetBrains Mono', monospace",
        uiSize: 13,
        uiFamily: "'SF Pro', sans-serif",
      },
      root,
    );
    expect(root.style.getPropertyValue("--tf-chat-family")).toContain("Inter");
    expect(root.style.getPropertyValue("--tf-code-family")).toContain("JetBrains Mono");
    expect(root.style.getPropertyValue("--tf-ui-family")).toContain("SF Pro");
  });

  it("removes family variable when value is empty string (default fallback)", () => {
    // First set a value, then clear — verify removal.
    root.style.setProperty("--tf-chat-family", "'Existing', sans-serif");
    applyFontVariables(
      { chatSize: 14, chatFamily: "", codeSize: 13, codeFamily: "", uiSize: 13, uiFamily: "" },
      root,
    );
    expect(root.style.getPropertyValue("--tf-chat-family")).toBe("");
    expect(root.style.getPropertyValue("--tf-code-family")).toBe("");
    expect(root.style.getPropertyValue("--tf-ui-family")).toBe("");
  });

  it("treats whitespace-only family as empty (removes variable)", () => {
    root.style.setProperty("--tf-ui-family", "'Existing', sans-serif");
    applyFontVariables(
      { chatSize: 14, chatFamily: "", codeSize: 13, codeFamily: "", uiSize: 13, uiFamily: "   " },
      root,
    );
    expect(root.style.getPropertyValue("--tf-ui-family")).toBe("");
  });
});

describe("fontSettings — T2 AppearanceSection UI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders all 3 region size + family inputs", () => {
    const { container } = render(<AppearanceSection />);
    expect(container.querySelector("#font-chat-size")).toBeTruthy();
    expect(container.querySelector("#font-chat-family")).toBeTruthy();
    expect(container.querySelector("#font-code-size")).toBeTruthy();
    expect(container.querySelector("#font-code-family")).toBeTruthy();
    expect(container.querySelector("#font-ui-size")).toBeTruthy();
    expect(container.querySelector("#font-ui-family")).toBeTruthy();
  });

  it("updates store after debounce when chat size input changes", () => {
    const { container } = render(<AppearanceSection />);
    const input = container.querySelector("#font-chat-size") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "18" } });
    // Before debounce flush, store still default
    expect(useFontSettingsStore.getState().settings.chatSize).toBe(DEFAULT_FONT_SETTINGS.chatSize);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(useFontSettingsStore.getState().settings.chatSize).toBe(18);
  });

  it("clamps out-of-range input on blur", () => {
    const { container } = render(<AppearanceSection />);
    const input = container.querySelector("#font-code-size") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.blur(input);
    expect(useFontSettingsStore.getState().settings.codeSize).toBe(FONT_SIZE_MAX);
  });

  it("recovers default when input is cleared and blurred", () => {
    const { container } = render(<AppearanceSection />);
    const input = container.querySelector("#font-ui-size") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    // Store remains at default (no patch fired with NaN)
    expect(useFontSettingsStore.getState().settings.uiSize).toBe(DEFAULT_FONT_SETTINGS.uiSize);
  });

  it("updates family field after debounce", () => {
    const { container } = render(<AppearanceSection />);
    const input = container.querySelector("#font-code-family") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "'Fira Code', monospace" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(useFontSettingsStore.getState().settings.codeFamily).toBe("'Fira Code', monospace");
  });
});
