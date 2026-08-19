import { useEffect, useRef } from 'react';
import { supabaseClient } from '../lib/db';

const LOCAL_GROUP_CHANGE_EVENT = 'splitmate:group-data-changed';
const FALLBACK_SYNC_INTERVAL_MS = 15_000;
const CHANGE_DEBOUNCE_MS = 350;

interface GroupChangeDetail {
  groupId: string;
}

/** Re-fetches group data after database changes or an explicit group broadcast. */
export function useRealtimeSync(groupId: string | null, onDataChanged: () => void | Promise<void>) {
  const onDataChangedRef = useRef(onDataChanged);

  useEffect(() => {
    onDataChangedRef.current = onDataChanged;
  }, [onDataChanged]);

  useEffect(() => {
    if (!groupId) return;

    let refreshTimer: number | null = null;
    let cancelled = false;
    let channel: ReturnType<typeof supabaseClient.channel> | null = null;

    // One expense creates several split rows. Debouncing prevents a burst of
    // identical dashboard requests while still updating promptly.
    const handleEvent = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!cancelled) void onDataChangedRef.current();
      }, CHANGE_DEBOUNCE_MS);
    };

    const handleLocalEvent = (event: Event) => {
      const detail = (event as CustomEvent<GroupChangeDetail>).detail;
      if (detail?.groupId === groupId) handleEvent();
    };

    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') handleEvent();
    };

    const connect = async () => {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) {
        console.warn('[Realtime] Could not restore the current session', error.message);
        return;
      }
      if (cancelled || !data.session?.access_token) return;

      // Realtime maintains its own socket authorization state. Explicitly give
      // it the restored/refreshed access token before opening a protected
      // channel so it cannot enter an unauthorized reconnect loop.
      await supabaseClient.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      const filter = `group_id=eq.${groupId}`;
      channel = supabaseClient
        .channel(`group-data:${groupId}`)
        .on('broadcast', { event: 'data-changed' }, handleEvent)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter }, handleEvent)
        // expense_splits has no group_id column, so it cannot use the group
        // filter. RLS still limits delivered rows to authorized group data.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, handleEvent)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter }, handleEvent)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter }, handleEvent)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter }, handleEvent)
        .subscribe((status, error) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[Realtime] Group channel ${status.toLowerCase()}`, error);
          }
        });
    };

    void connect();

    const { data: authListener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) void supabaseClient.realtime.setAuth(session.access_token);
    });

    // Realtime is the primary path. These lightweight recovery paths ensure a
    // sleeping mobile tab or temporary socket failure never leaves stale data.
    const fallbackTimer = window.setInterval(refreshWhenActive, FALLBACK_SYNC_INTERVAL_MS);
    window.addEventListener(LOCAL_GROUP_CHANGE_EVENT, handleLocalEvent);
    window.addEventListener('focus', refreshWhenActive);
    window.addEventListener('online', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(fallbackTimer);
      authListener.subscription.unsubscribe();
      window.removeEventListener(LOCAL_GROUP_CHANGE_EVENT, handleLocalEvent);
      window.removeEventListener('focus', refreshWhenActive);
      window.removeEventListener('online', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
      if (channel) void supabaseClient.removeChannel(channel);
    };
  }, [groupId]);
}

export async function notifyGroupDataChanged(groupId: string) {
  if (!groupId) return;

  // Update every listener in this browser immediately, independently of the
  // network socket. Other devices receive the broadcast below.
  window.dispatchEvent(new CustomEvent<GroupChangeDetail>(LOCAL_GROUP_CHANGE_EVENT, {
    detail: { groupId },
  }));

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.warn('[Realtime] Could not send group update', error.message);
    return;
  }
  if (!data.session?.access_token) return;
  await supabaseClient.realtime.setAuth(data.session.access_token);

  // Sending before subscribing uses Supabase's REST Broadcast path. It avoids
  // opening a second socket subscription with the same topic as the listener.
  const channel = supabaseClient.channel(`group-data:${groupId}`);
  try {
    const response = await channel.send({
      type: 'broadcast',
      event: 'data-changed',
      payload: { groupId, timestamp: Date.now() },
    });
    if (response !== 'ok') console.warn('[Realtime] Group update was not acknowledged', response);
  } catch (sendError) {
    // The committed database change remains safe. Postgres Changes and the
    // visibility/polling recovery paths will still deliver the refresh.
    console.warn('[Realtime] Group update broadcast failed', sendError);
  } finally {
    await supabaseClient.removeChannel(channel);
  }
}
