import { useEffect, useRef } from 'react';
import insforge from '../lib/db';

/**
 * Subscribes to a group-scoped realtime channel on InsForge.
 * When any member publishes a 'data-changed' event on this group's channel,
 * the provided `onDataChanged` callback is called so callers can re-fetch.
 *
 * Also re-fetches when the window regains focus (Fix 3).
 *
 * The channel is automatically unsubscribed on unmount or when groupId changes.
 */
export function useRealtimeSync(groupId: string | null, onDataChanged: () => void) {
  // Keep a stable ref so the effect closure always calls the latest version
  const onDataChangedRef = useRef(onDataChanged);
  onDataChangedRef.current = onDataChanged;

  useEffect(() => {
    if (!groupId) return;

    const channel = `group-data:${groupId}`;
    let subscribed = false;

    const handleEvent = () => {
      onDataChangedRef.current();
    };

    // Connect + subscribe to the group channel
    (async () => {
      try {
        await insforge.realtime.connect();
        const result = await insforge.realtime.subscribe(channel);
        if (result.ok) {
          subscribed = true;
          insforge.realtime.on('data-changed', handleEvent);
        } else {
          console.warn('[Realtime] Failed to subscribe:', result.error?.message);
        }
      } catch (err) {
        console.warn('[Realtime] Connection error:', err);
      }
    })();

    // Fix 3: Re-fetch on window focus
    const handleFocus = () => onDataChangedRef.current();
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      if (subscribed) {
        insforge.realtime.off('data-changed', handleEvent);
        insforge.realtime.unsubscribe(channel);
      }
    };
  }, [groupId]);
}

/**
 * Publishes a 'data-changed' event to the group channel so all
 * other subscribed clients know to re-fetch. Call this after any
 * write operation (add expense, delete expense, settle up).
 */
export async function notifyGroupDataChanged(groupId: string) {
  if (!groupId) return;
  const channel = `group-data:${groupId}`;
  try {
    // Make sure we're subscribed before publishing
    await insforge.realtime.connect();
    await insforge.realtime.subscribe(channel);
    await insforge.realtime.publish(channel, 'data-changed', {
      ts: Date.now(),
    });
  } catch (err) {
    // Non-fatal — the writer's own optimistic update already applied
    console.warn('[Realtime] Failed to publish data-changed event:', err);
  }
}
