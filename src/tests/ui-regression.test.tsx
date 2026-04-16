/**
 * P2: UI 회귀 테스트
 *
 * Pure/presentational 컴포넌트와 유틸리티 함수 렌더링 검증.
 * Store 의존 컴포넌트(RuntimeStatusBar, TracePanel)는 제외 — mock 복잡도 과도.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  TraceSpanCard,
  ContextUsageBar,
  formatDuration,
  formatCost,
  formatTokens,
  formatTime,
  baseMode,
  contextModeColor,
  contextModeAbbrev,
  calcTokPerSec,
  getContextLimit,
  type TraceSpan,
} from "@/components/tunaflow/context-panel/TraceSpanCard";

// ─── Formatting utility tests ──────────────────────────────────────────────

describe("TraceSpanCard — formatDuration", () => {
  it("returns — for null", () => expect(formatDuration(null)).toBe("—"));
  it("shows ms for < 1000", () => expect(formatDuration(500)).toBe("500ms"));
  it("shows seconds for >= 1000", () => expect(formatDuration(2500)).toBe("2.5s"));
  it("handles zero", () => expect(formatDuration(0)).toBe("0ms"));
});

describe("TraceSpanCard — formatCost", () => {
  it("returns $0 for zero cost", () => expect(formatCost(0)).toBe("$0"));
  it("returns N/A for gemini with zero cost", () => expect(formatCost(0, "gemini")).toBe("N/A"));
  it("returns N/A for ollama with zero cost", () => expect(formatCost(0, "ollama")).toBe("N/A"));
  it("formats small cost with 4 decimals", () => expect(formatCost(0.005)).toBe("$0.0050"));
  it("formats normal cost with 2 decimals", () => expect(formatCost(1.5)).toBe("$1.50"));
});

describe("TraceSpanCard — formatTokens", () => {
  it("formats with locale separators", () => expect(formatTokens(12345)).toBe("12,345"));
  it("returns N/A for ollama with zero", () => expect(formatTokens(0, "ollama")).toBe("N/A"));
  it("formats zero for claude", () => expect(formatTokens(0, "claude")).toBe("0"));
});

describe("TraceSpanCard — formatTime", () => {
  it("returns formatted time string", () => {
    const result = formatTime(1712345678);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("TraceSpanCard — baseMode", () => {
  it("extracts base from auto format", () => expect(baseMode("Standard(auto:standard(baseline))")).toBe("standard"));
  it("handles plain mode", () => expect(baseMode("Full")).toBe("full"));
  it("handles lite", () => expect(baseMode("Lite")).toBe("lite"));
});

describe("TraceSpanCard — contextModeAbbrev", () => {
  it("abbreviates Standard", () => expect(contextModeAbbrev("Standard(auto:standard(baseline))")).toBe("Std"));
  it("abbreviates Full", () => expect(contextModeAbbrev("Full")).toBe("Full"));
  it("abbreviates Lite", () => expect(contextModeAbbrev("Lite")).toBe("Lite"));
});

describe("TraceSpanCard — contextModeColor", () => {
  it("returns purple for full", () => expect(contextModeColor("Full")).toContain("purple"));
  it("returns blue for standard", () => expect(contextModeColor("Standard")).toContain("blue"));
  it("returns muted for lite", () => expect(contextModeColor("Lite")).toContain("muted"));
});

describe("TraceSpanCard — calcTokPerSec", () => {
  it("returns null for zero duration", () => {
    expect(calcTokPerSec({ durationMs: 0, outputTokens: 100 } as TraceSpan)).toBeNull();
  });
  it("returns null for null duration", () => {
    expect(calcTokPerSec({ durationMs: null, outputTokens: 100 } as TraceSpan)).toBeNull();
  });
  it("calculates correctly", () => {
    expect(calcTokPerSec({ durationMs: 2000, outputTokens: 100 } as TraceSpan)).toBe(50);
  });
});

describe("TraceSpanCard — getContextLimit", () => {
  it("returns 1M for claude-opus-4-6", () => expect(getContextLimit("claude-opus-4-6")).toBe(1_000_000));
  it("returns 200K for claude-sonnet-4-6", () => expect(getContextLimit("claude-sonnet-4-6")).toBe(200_000));
  it("prefix matches versioned models", () => expect(getContextLimit("claude-sonnet-4-6-20260301")).toBe(200_000));
  it("returns 200K fallback for unknown", () => expect(getContextLimit("unknown-model")).toBe(200_000));
  it("returns 200K for null", () => expect(getContextLimit(null)).toBe(200_000));
});

// ─── Component render tests ────────────────────────────────────────────────

function makeSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    id: 1,
    conversationId: "conv-1",
    traceId: "t1",
    spanId: "s1",
    parentSpanId: null,
    operation: "send",
    engine: "claude-code",
    inputTokens: 5000,
    outputTokens: 1500,
    costUsd: 0.05,
    durationMs: 3200,
    status: "ok",
    recordedAt: Math.floor(Date.now() / 1000),
    contextMode: null,
    contextSections: null,
    contextLength: null,
    contextHash: null,
    contextTruncated: null,
    messageId: null,
    ...overrides,
  };
}

describe("TraceSpanCard — render", () => {
  it("renders engine and status", () => {
    render(<TraceSpanCard span={makeSpan()} model={null} />);
    expect(screen.getByText("claude-code")).toBeTruthy();
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("renders duration and tokens", () => {
    render(<TraceSpanCard span={makeSpan()} model={null} />);
    expect(screen.getByText("3.2s")).toBeTruthy();
    expect(screen.getByText(/6,500 tok/)).toBeTruthy(); // 5000 + 1500
  });

  it("renders cost", () => {
    render(<TraceSpanCard span={makeSpan()} model={null} />);
    expect(screen.getByText("$0.05")).toBeTruthy();
  });

  it("renders context mode when present", () => {
    const span = makeSpan({
      contextMode: "Standard(auto:standard(baseline))",
      contextSections: '["project","platform","context","plan"]',
      contextLength: 12500,
    });
    render(<TraceSpanCard span={span} model={null} />);
    expect(screen.getByText("Standard(auto:standard(baseline))")).toBeTruthy();
    expect(screen.getByText("project")).toBeTruthy();
    expect(screen.getByText("plan")).toBeTruthy();
    expect(screen.getByText("12.5k chars")).toBeTruthy();
  });

  it("renders skipped sections with strikethrough", () => {
    const span = makeSpan({
      contextMode: "Standard",
      contextSections: '["project","retrieval:skipped"]',
    });
    render(<TraceSpanCard span={span} model={null} />);
    expect(screen.getByText("project")).toBeTruthy();
    expect(screen.getByText("retrieval")).toBeTruthy(); // skipped label stripped
  });

  it("renders section budget breakdown", () => {
    const span = makeSpan({
      contextMode: "Full",
      contextHash: '[{"name":"context","chars":3200},{"name":"skills","chars":5100}]',
    });
    render(<TraceSpanCard span={span} model={null} />);
    expect(screen.getByText(/skills:5.1k/)).toBeTruthy();
    expect(screen.getByText(/context:3.2k/)).toBeTruthy();
  });

  it("renders error status", () => {
    render(<TraceSpanCard span={makeSpan({ status: "error" })} model={null} />);
    expect(screen.getByText("error")).toBeTruthy();
  });

  it("renders token speed", () => {
    const span = makeSpan({ durationMs: 2000, outputTokens: 100 });
    render(<TraceSpanCard span={span} model={null} />);
    expect(screen.getByText("50 t/s")).toBeTruthy();
  });
});

describe("ContextUsageBar — render", () => {
  it("renders percentage and limit", () => {
    render(<ContextUsageBar inputTokens={50000} model="claude-sonnet-4-6" />);
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("200K")).toBeTruthy();
  });

  it("returns null for zero tokens", () => {
    const { container } = render(<ContextUsageBar inputTokens={0} model="claude-sonnet-4-6" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows 1M for opus model", () => {
    render(<ContextUsageBar inputTokens={100000} model="claude-opus-4-6" />);
    expect(screen.getByText("1M")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
  });

  it("shows warning icon at 80%+", () => {
    render(<ContextUsageBar inputTokens={170000} model="claude-sonnet-4-6" />);
    // 170k / 200k = 85%
    expect(screen.getByText("85%")).toBeTruthy();
  });
});
