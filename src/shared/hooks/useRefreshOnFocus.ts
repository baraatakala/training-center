import { useEffect } from 'react';

/**
 * Calls the provided function when the browser tab becomes visible again.
 * Prevents stale data when users switch back to the app.
 * The callback should be stable (wrap in useCallback).
 */
export function useRefreshOnFocus(refetchFn: () => void) {
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        refetchFn();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [refetchFn]);
}
