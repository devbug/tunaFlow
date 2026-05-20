import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFontSettingsStore, FONT_SIZE_MIN, FONT_SIZE_MAX, clampFontSize, type FontSettings } from "@/stores/fontSettingsStore";

// debounce 200ms — slider / spinner 연속 입력 시 store update 폭주 차단 (plan §3 T2).
const PERSIST_DEBOUNCE_MS = 200;

type RegionKey = "chat" | "code" | "ui";
type SizeField = "chatSize" | "codeSize" | "uiSize";
type FamilyField = "chatFamily" | "codeFamily" | "uiFamily";

const REGIONS: { key: RegionKey; sizeField: SizeField; familyField: FamilyField }[] = [
  { key: "chat", sizeField: "chatSize", familyField: "chatFamily" },
  { key: "code", sizeField: "codeSize", familyField: "codeFamily" },
  { key: "ui", sizeField: "uiSize", familyField: "uiFamily" },
];

export function AppearanceSection() {
  const { t } = useTranslation("settings");
  const settings = useFontSettingsStore((s) => s.settings);
  const loaded = useFontSettingsStore((s) => s.loaded);
  const load = useFontSettingsStore((s) => s.load);
  const update = useFontSettingsStore((s) => s.update);
  const reset = useFontSettingsStore((s) => s.reset);

  // Local mirror — store 의 source of truth 와 동기화하되, 빠른 입력 시 즉시 UI 반영
  // (re-render 폭풍은 debounce 로 store update 단계에서 차단).
  const [local, setLocal] = useState<FontSettings>(settings);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  // store → local sync (다른 곳에서 reset 등으로 변경 시).
  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  // T3 (Gemini medium): unmount 시 잔존 debounce timer 가 setState 를
  // 트리거하지 않도록 cleanup. SettingsPanel 을 닫는 순간 컴포넌트가 unmount
  // 되어도 200ms 이내 마지막 keystroke 가 남아 있으면 store update 가 dead
  // component 위에서 실행되며 React warning 을 유발.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  const scheduleUpdate = (patch: Partial<FontSettings>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      update(patch);
      debounceRef.current = null;
    }, PERSIST_DEBOUNCE_MS);
  };

  const handleSizeChange = (field: SizeField, raw: string) => {
    // T4 (Gemini medium, 옵션 A): size 입력 중에는 store 를 건드리지 않는다.
    // 기존 구현은 `scheduleUpdate` 로 200ms debounce 후 store 의 `update` 를
    // 호출했는데, `update` 내부 `clampFontSize` 가 즉시 [10,24] 범위로 튕겨
    // 사용자가 '15' 를 입력하려고 '1' 만 친 시점에서 화면이 10 으로 점프하던
    // 마찰을 차단. local draft 만 갱신하고 store 반영은 onBlur 또는 다음
    // commit 시점에서만 수행.
    if (raw === "") {
      setLocal((prev) => ({ ...prev, [field]: NaN as unknown as number }));
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setLocal((prev) => ({ ...prev, [field]: n }));
  };

  const handleSizeBlur = (field: SizeField) => {
    // blur 시 local 값을 store 기준으로 정규화 (NaN 또는 범위 외 입력 회복).
    // T4: 옵션 A 에서 store 호출은 이 시점에만 이뤄진다. 사용자가 raw 값을
    // 그대로 두고 blur 했다면 clamp 결과를 local 과 store 양쪽에 반영.
    const currentLocal = (local[field] as unknown) as number;
    if (!Number.isFinite(currentLocal)) {
      setLocal((prev) => ({ ...prev, [field]: settings[field] }));
      return;
    }
    const clamped = clampFontSize(currentLocal, settings[field]);
    if (clamped !== currentLocal) {
      setLocal((prev) => ({ ...prev, [field]: clamped }));
    }
    if (clamped !== settings[field]) {
      update({ [field]: clamped } as Partial<FontSettings>);
    }
  };

  const handleFamilyChange = (field: FamilyField, raw: string) => {
    scheduleUpdate({ [field]: raw } as Partial<FontSettings>);
  };

  return (
    <div>
      <h2 className="text-[14px] font-[550] text-foreground mb-1">{t("appearance.fonts.title")}</h2>
      <p className="text-[12px] text-muted-foreground mb-4">{t("appearance.fonts.description")}</p>

      <div className="space-y-5">
        {REGIONS.map((region) => {
          const sizeValue = local[region.sizeField] as number;
          const familyValue = local[region.familyField] as string;
          const sizeDisplay = Number.isFinite(sizeValue) ? sizeValue : "";
          return (
            <div key={region.key} className="space-y-2">
              <h3 className="text-[12px] font-semibold text-foreground/80">
                {t(`appearance.fonts.region.${region.key}`)}
              </h3>

              <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
                <label htmlFor={`font-${region.key}-size`} className="text-[12px] text-muted-foreground">
                  {t("appearance.fonts.size_label")}
                </label>
                <input
                  id={`font-${region.key}-size`}
                  type="number"
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={1}
                  value={sizeDisplay}
                  onChange={(e) => handleSizeChange(region.sizeField, e.target.value)}
                  onBlur={() => handleSizeBlur(region.sizeField)}
                  className="w-24 text-[12px] bg-background border border-border/40 rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary/60"
                />
              </div>

              <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
                <label htmlFor={`font-${region.key}-family`} className="text-[12px] text-muted-foreground">
                  {t("appearance.fonts.family_label")}
                </label>
                <input
                  id={`font-${region.key}-family`}
                  type="text"
                  value={familyValue}
                  placeholder={t(`appearance.fonts.placeholder.${region.key}`)}
                  onChange={(e) => handleFamilyChange(region.familyField, e.target.value)}
                  className="text-[12px] bg-background border border-border/40 rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary/60"
                />
              </div>
            </div>
          );
        })}

        <div className="pt-2 border-t border-border/20">
          <button
            type="button"
            onClick={reset}
            className="text-[12px] px-3 py-1.5 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          >
            {t("appearance.fonts.reset_all")}
          </button>
          <p className="text-[11px] text-muted-foreground/60 mt-2">
            {t("appearance.fonts.hint")}
          </p>
        </div>
      </div>
    </div>
  );
}
