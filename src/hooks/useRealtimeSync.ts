import { useEffect, useRef } from 'react';
import { supabaseClient } from '../lib/db';

/** Re-fetches group data after database changes or an explicit group broadcast. */
export function useRealtimeSync(groupId: string | null, onDataChanged: () => void) {
  const onDataChangedRef = useRef(onDataChanged);

  useEffect(() => {
    onDataChangedRef.current = onDataChanged;
  }, [onDataChanged]);

  useEffect(() => {
    if (!groupId) return;

    const handleEvent = () => onDataChangedRef.current();
    const filter = `group_id=eq.${groupId}`;
    const channel = supabaseClient
      .channel(`group-data:${groupId}`)
      .on('broadcast', { event: 'data-changed' }, handleEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter }, handleEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter }, handleEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter }, handleEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter }, handleEvent)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[Realtime] Group channel ${status.toLowerCase()}`);
        }
      });

    window.addEventListener('focus', handleEvent);
    return () => {
      window.removeEventListener('focus', handleEvent);
      void supabaseClient.removeChannel(channel);
    };
  }, [groupId]);
}

export async function notifyGroupDataChanged(groupId: string) {
  if (!groupId) return;

  const channel = supabaseClient.channel(`group-data:${groupId}`);
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 2_000);
    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      window.clearTimeout(timeout);
      await channel.send({
        type: 'broadcast',
        event: 'data-changed',
        payload: { groupId, timestamp: Date.now() },
      });
      resolve();
    });
  });
  await supabaseClient.removeChannel(channel);
}
