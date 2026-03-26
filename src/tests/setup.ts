import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock Tauri IPC — all invoke calls return empty by default
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));
