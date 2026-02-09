import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

/**
 * Returns true if the browser is online, false if offline.
 * Automatically updates when connectivity changes.
 */
export function useOnlineStatus() {
  // useSyncExternalStore is the React 18+ way to subscribe to external state
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
