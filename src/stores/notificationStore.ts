import { create } from "zustand";

export type NotificationType = "completed" | "error" | "info";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  conversationId?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

const MAX_NOTIFICATIONS = 50;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,

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
}));

/** Send OS notification (if app not focused) + add to history. */
export async function notify(
  type: NotificationType,
  title: string,
  body: string,
  conversationId?: string,
): Promise<void> {
  // Add to in-app history
  useNotificationStore.getState().addNotification({ type, title, body, conversationId });

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
