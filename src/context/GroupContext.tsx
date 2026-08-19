/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { dbQuery } from '../lib/db';
import { useAuth } from './AuthContext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GroupContext = createContext<any>(null);

export function GroupProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [groups, setGroups] = useState<any[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() => localStorage.getItem('activeGroupId'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroup = async () => {
    if (!user || authLoading) return;
    setLoading(true);
    setError(null);
    try {
      // Step 1: get ALL group_ids for this user
      const memberships = await dbQuery('group_members', `user_id=eq.${user.id}&select=group_id`);
      if (!memberships || memberships.length === 0) {
        setGroups([]);
        setActiveGroupId(null);
        localStorage.removeItem('activeGroupId');
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gIds = memberships.map((m: any) => m.group_id);

      // Step 2: fetch details for ALL groups user belongs to
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groupDetails: any = await dbQuery('groups', `id=in.(${gIds.join(',')})&select=id,name,invite_code`);
      if (!groupDetails || groupDetails.length === 0) return;

      setGroups(groupDetails);

      // Determine active group (fallback to first if none saved or saved is no longer in list)
      let currentActiveId = activeGroupId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!currentActiveId || !groupDetails.find((g: any) => g.id === currentActiveId)) {
        currentActiveId = groupDetails[0].id;
        setActiveGroupId(currentActiveId);
        if (currentActiveId) localStorage.setItem('activeGroupId', currentActiveId);
      }

      if (currentActiveId) {
        fetchMembers(currentActiveId);
      }
    } catch (e) {
      console.error('Failed fetching groups', e);
      // Preserve any already-loaded groups on transient auth/network failures.
      // An error is not the same thing as a user having no memberships.
      setError(e instanceof Error ? e.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  const switchGroup = (newId: string) => {
    setActiveGroupId(newId);
    localStorage.setItem('activeGroupId', newId);
    fetchMembers(newId);
  };

  const fetchMembers = async (gId: string) => {
    try {
      const memberRows = await dbQuery('group_members', `group_id=eq.${gId}&select=user_id`);
      if (!memberRows?.length) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userIds = memberRows.map((m: any) => m.user_id);
      const [userDetails, paymentProfiles] = await Promise.all([
        dbQuery('users', `id=in.(${userIds.join(',')})&select=id,full_name,email,role,avatar_url`),
        dbQuery('user_payment_profiles', `user_id=in.(${userIds.join(',')})&select=user_id,whatsapp_number,upi_id`)
          .catch((error) => {
            console.error('Payment profiles are unavailable; run the payment profile migration', error);
            return [];
          }),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usersById = new Map((userDetails || []).map((profile: any) => [profile.id, profile]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paymentsById = new Map((paymentProfiles || []).map((profile: any) => [profile.user_id, profile]));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const combined = memberRows.map((m: any) => ({
        user_id: m.user_id,
        users: usersById.has(m.user_id)
          ? { ...usersById.get(m.user_id), ...paymentsById.get(m.user_id) }
          : null
      }));

      setMembers(combined);
    } catch (e) { console.error('Failed fetching members', e); }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setGroups([]);
      setMembers([]);
      setActiveGroupId(null);
      setLoading(false);
      return;
    }
    fetchGroup();
  }, [user, authLoading]);

  // Derived state for the currently active group for backwards compatibility
  const currentGroup = groups.find(g => g.id === activeGroupId) || null;
  const groupId = currentGroup?.id || null;
  const groupName = currentGroup?.name || '';
  const inviteCode = currentGroup?.invite_code || '';

  return (
    <GroupContext.Provider value={{
      groupId, groupName, inviteCode,
      currentGroup,
      groups,
      switchGroup,
      members,
      loading,
      error,
      fetchMembers,
      refreshGroup: fetchGroup
    }}>
      {children}
    </GroupContext.Provider>
  );
}

export function useGroup() {
  return useContext(GroupContext);
}
