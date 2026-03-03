/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { dbQuery } from '../lib/db';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import { useAuth } from './AuthContext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GroupContext = createContext<any>(null);

export function GroupProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [groups, setGroups] = useState<any[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() => localStorage.getItem('activeGroupId'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [members, setMembers] = useState<any[]>([]);

  const fetchGroup = async () => {
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
      const userDetails = await Promise.all(
        userIds.map((uid: string) =>
          dbQuery('users', `id=eq.${uid}&select=id,full_name,email,role,avatar_url`)
            .then(rows => rows?.[0])
            .catch(() => null)
        )
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const combined = memberRows.map((m: any, i: number) => ({
        user_id: m.user_id,
        users: userDetails[i] ?? null
      }));

      setMembers(combined);
    } catch (e) { console.error('Failed fetching members', e); }
  };

  useEffect(() => {
    if (!user) return;
    fetchGroup();
  }, [user]);

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
