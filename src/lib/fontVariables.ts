// CSS variable injection for custom font settings.
// Plan: docs/plans/customFontSettingsPlan_2026-05-12.md §3 T3
//
// AppShell 이 본 모듈의 hook 을 1 회 마운트해 fontSettings store 를 구독하고,
// 변경 시 `document.documentElement.style.setProperty` 로 CSS variable 6 개를 갱신.
// Family 빈 값은 변수 자체를 remove → :root 의 default 값 (index.css) 로 회복 — INV-CFS-3.

import { useEffect } from "react";
import { useFontSettingsStore, type FontSettings } from "@/stores/fontSettingsStore";

const CHAT_SIZE_VAR = "--tf-chat-size";
const CHAT_FAMILY_VAR = "--tf-chat-family";
const CODE_SIZE_VAR = "--tf-code-size";
const CODE_FAMILY_VAR = "--tf-code-family";
const UI_SIZE_VAR = "--tf-ui-size";
const UI_FAMILY_VAR = "--tf-ui-family";

/**
 * Apply font settings to <html> CSS variables.
 *
 * - size: 항상 `${n}px` 로 setProperty.
 * - family: 빈 문자열이면 removeProperty (→ :root default 회복). 비어있지 않으면
 *   문자열 그대로 setProperty (사용자 입력 — 잘못된 family 도 브라우저가 fallback).
 *
 * 본 함수는 idempotent — 같은 settings 로 반복 호출해도 부작용 없음.
 */
export function applyFontVariables(settings: FontSettings, root: HTMLElement = document.documentElement): void {
  root.style.setProperty(CHAT_SIZE_VAR, `${settings.chatSize}px`);
  root.style.setProperty(CODE_SIZE_VAR, `${settings.codeSize}px`);
  root.style.setProperty(UI_SIZE_VAR, `${settings.uiSize}px`);

  if (settings.chatFamily.trim() === "") {
    root.style.removeProperty(CHAT_FAMILY_VAR);
  } else {
    root.style.setProperty(CHAT_FAMILY_VAR, settings.chatFamily);
  }

  if (settings.codeFamily.trim() === "") {
    root.style.removeProperty(CODE_FAMILY_VAR);
  } else {
    root.style.setProperty(CODE_FAMILY_VAR, settings.codeFamily);
  }

  if (settings.uiFamily.trim() === "") {
    root.style.removeProperty(UI_FAMILY_VAR);
  } else {
    root.style.setProperty(UI_FAMILY_VAR, settings.uiFamily);
  }
}

/**
 * Mount-once hook — fontSettings store 를 구독해 CSS variable 자동 동기화.
 *
 * AppShell 의 root 에서 1 회 호출. 본 hook 이 마운트되기 전엔 :root 의 default
 * 값이 적용되므로 회귀 0 (INV-CFS-1). store.load() 가 완료되면 사용자 설정으로
 * 덮어쓴다.
 */
export function useFontVariableSync(): void {
  const settings = useFontSettingsStore((s) => s.settings);
  const loaded = useFontSettingsStore((s) => s.loaded);
  const load = useFontSettingsStore((s) => s.load);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    applyFontVariables(settings);
  }, [settings]);
}
