import { create } from "zustand";
import { getSetting, setSetting } from "@/lib/appStore";

export type NotificationType = "completed" | "error" | "info";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  engine?: string;
  conversationTitle?: string;
  preview?: string;
  conversationId?: string;
  timestamp: number;
  read: boolean;
}

export interface NotifyMeta {
  engine?: string;
  conversationTitle?: string;
  preview?: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  soundEnabled: boolean;
  addNotification: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markAllRead: () => void;
  clearAll: () => void;
  toggleSound: () => void;
  loadSoundSetting: () => void;
}

const MAX_NOTIFICATIONS = 50;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  soundEnabled: true,

  addNotification: (n) => {
    const notification: AppNotification = {
      ...n,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      read: false,
    };
    set((state) => {
      const next = [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      return { notifications: next, unreadCount: state.unreadCount + 1 };
    });
  },

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  clearAll: () => set({ notifications: [], unreadCount: 0 }),

  toggleSound: () => {
    const next = !get().soundEnabled;
    set({ soundEnabled: next });
    setSetting("notificationSound", next);
  },

  loadSoundSetting: () => {
    getSetting("notificationSound", true).then((v) => set({ soundEnabled: v }));
  },
}));

// ─── Notification sound via Web Audio API (no external file needed) ──────────

let audioCtx: AudioContext | null = null;

function playNotificationSound(type: NotificationType) {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "error") {
      // Low double beep for errors
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.setValueAtTime(300, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } else {
      // Pleasant chime for completed/info
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch (e) {
    console.debug("[notify-sound]", e);
  }
}

// ─── Central notify function ─────────────────────────────────────────────────

/** Send OS notification (if app not focused) + add to history + play sound. */
export async function notify(
  type: NotificationType,
  title: string,
  body: string,
  conversationId?: string,
  meta?: NotifyMeta,
): Promise<void> {
  // Add to in-app history
  useNotificationStore.getState().addNotification({
    type, title, body, conversationId,
    engine: meta?.engine,
    conversationTitle: meta?.conversationTitle,
    preview: meta?.preview,
  });

  // Play sound if enabled
  if (useNotificationStore.getState().soundEnabled) {
    playNotificationSound(type);
  }

  // OS notification only when app is not focused
  if (document.hidden) {
    try {
      const { sendNotification, isPermissionGranted } = await import("@tauri-apps/plugin-notification");
      const granted = await isPermissionGranted();
      if (granted) {
        sendNotification({ title, body });
      }
    } catch (e) {
      console.debug("[notify]", e);
    }
  }
}
