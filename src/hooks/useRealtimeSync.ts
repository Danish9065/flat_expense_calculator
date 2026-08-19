import { useEffect, useRef } from 'react';
import { supabaseClient } from '../lib/db';

const LOCAL_GROUP_CHANGE_EVENT = 'splitmate:group-data-changed';
const FALLBACK_SYNC_INTERVAL_MS = 15_000;
const CHANGE_DEBOUNCE_MS = 350;

interface GroupChangeDetail {
  groupId: string;
}

function useRealtimeGroupCollection(
  groupIds: string[],
  onDataChanged: () => void | Promise<void>,
  allGroups: boolean,
) {
  const onDataChangedRef = useRef(onDataChanged);
  const groupKey = Array.from(new Set(groupIds.filter(Boolean))).sort().join(',');

  useEffect(() => {
    onDataChangedRef.current = onDataChanged;
  }, [onDataChanged]);

  useEffect(() => {
    const normalizedGroupIds = groupKey ? groupKey.split(',') : [];
    if (normalizedGroupIds.length === 0) return;

    let refreshTimer: number | null = null;
    let cancelled = false;
    const channels: Array<ReturnType<typeof supabaseClient.channel>> = [];

    const handleEvent = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!cancelled) void onDataChangedRef.current();
      }, CHANGE_DEBOUNCE_MS);
    };

    const handleLocalEvent = (event: Event) => {
      const detail = (event as CustomEvent<GroupChangeDetail>).detail;
      if (detail?.groupId && normalizedGroupIds.includes(detail.groupId)) handleEvent();
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
      await supabaseClient.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      if (allGroups) {
        // RLS limits these unfiltered events to rows the signed-in user may
        // access. A single database channel keeps every group summary current.
        const databaseChannel = supabaseClient
          .channel(`all-group-data:${normalizedGroupIds.length}:${normalizedGroupIds[0]}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'user_payment_profiles' }, handleEvent)
          .subscribe((status, channelError) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn(`[Realtime] All-groups channel ${status.toLowerCase()}`, channelError);
            }
          });
        channels.push(databaseChannel);

        for (const groupId of normalizedGroupIds) {
          const broadcastChannel = supabaseClient
            .channel(`group-data:${groupId}`)
            .on('broadcast', { event: 'data-changed' }, handleEvent)
            .subscribe();
          channels.push(broadcastChannel);
        }
      } else {
        const groupId = normalizedGroupIds[0];
        const filter = `group_id=eq.${groupId}`;
        const groupChannel = supabaseClient
          .channel(`group-data:${groupId}`)
          .on('broadcast', { event: 'data-changed' }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter }, handleEvent)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter }, handleEvent)
          .subscribe((status, channelError) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn(`[Realtime] Group channel ${status.toLowerCase()}`, channelError);
            }
          });
        channels.push(groupChannel);
      }
    };

    void connect();
    const { data: authListener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) void supabaseClient.realtime.setAuth(session.access_token);
    });
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
      for (const channel of channels) void supabaseClient.removeChannel(channel);
    };
  }, [allGroups, groupKey]);
}

/** Re-fetches group data after database changes or an explicit group broadcast. */
export function useRealtimeSync(groupId: string | null, onDataChanged: () => void | Promise<void>) {
  useRealtimeGroupCollection(groupId ? [groupId] : [], onDataChanged, false);
}

/** Keeps the combined payment view synchronized with every accessible group. */
export function useAllGroupsRealtimeSync(groupIds: string[], onDataChanged: () => void | Promise<void>) {
  useRealtimeGroupCollection(groupIds, onDataChanged, true);
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
