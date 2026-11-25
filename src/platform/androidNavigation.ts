import { useSyncExternalStore } from 'react';

const KEY = 'lanis_android_navigation';
const SHOW_LABELS_KEY = 'lanis_android_navigation_show_labels';
const EVENT = 'lanis:android-navigation';
export const DEFAULT_ANDROID_TABS = ['dashboard', 'timetable', 'messages', 'courses'];
export const ANDROID_TAB_IDS = ['dashboard', 'timetable', 'messages', 'courses', 'calendar', 'study-groups', 'dateispeicher', 'dateiverteilung', 'videokonferenz', 'vertretungsplan', 'dsb', 'wahlen', 'profile', 'settings', 'search'];
export function normalizeAndroidTabs(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && ANDROID_TAB_IDS.includes(id)))]
    : [...DEFAULT_ANDROID_TABS];
}
function snapshot() { return localStorage.getItem(KEY) || ''; }
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', listener); };
}
export function useAndroidTabs(): [string[], (tabs: string[]) => void] {
  const stored = useSyncExternalStore(subscribe, snapshot);
  let parsed: unknown;
  try { parsed = JSON.parse(stored); } catch { parsed = null; }
  return [normalizeAndroidTabs(parsed), tabs => {
    localStorage.setItem(KEY, JSON.stringify(normalizeAndroidTabs(tabs)));
    window.dispatchEvent(new Event(EVENT));
  }];
}

function showLabelsSnapshot() { return localStorage.getItem(SHOW_LABELS_KEY) !== 'false'; }

export function useAndroidTabLabels(): [boolean, (showLabels: boolean) => void] {
  const showLabels = useSyncExternalStore(subscribe, showLabelsSnapshot);
  return [showLabels, value => {
    localStorage.setItem(SHOW_LABELS_KEY, String(value));
    window.dispatchEvent(new Event(EVENT));
  }];
}
