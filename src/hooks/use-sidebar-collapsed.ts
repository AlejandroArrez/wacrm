"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "strato.sidebar.collapsed";
const EVENT = "strato:sidebar-collapsed";

// In-memory copy so the toggle still works when storage is blocked
// (private windows): it just isn't remembered across reloads.
let memory: boolean | null = null;

function read(): boolean {
  if (memory !== null) return memory;
  try {
    memory = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    memory = false;
  }
  return memory;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    memory = e.newValue === "1";
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Desktop sidebar collapsed to icons only. Remembered per device in
 * localStorage (best-effort: private windows or blocked storage keep
 * it for the session only). The server render is always expanded; the
 * mobile drawer ignores it. Other tabs follow along via `storage`.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);

  const toggle = useCallback(() => {
    memory = !read();
    try {
      localStorage.setItem(STORAGE_KEY, memory ? "1" : "0");
    } catch {
      /* storage unavailable — kept in memory only */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [collapsed, toggle];
}
