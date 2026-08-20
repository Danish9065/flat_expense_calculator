export const GROUP_DATA_CHANGED_EVENT = 'splitmate:group-data-changed';
export const PROFILE_CHANGED_EVENT = 'splitmate:profile-changed';

export interface GroupDataChangedDetail {
  groupId: string;
}

export interface ProfileChangedDetail {
  userId: string;
}
