export function generateInviteKey(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let key = 'SPLIT-';
    for (let i = 0; i < 6; i++) {
        key += chars[Math.floor(Math.random() * chars.length)];
    }
    return key; // e.g. SPLIT-K7MN2P
}

export type InviteKeyStatus = 'available' | 'used' | 'expired' | 'invalid';

export function normalizeInviteKey(value: string): string {
    return value.trim().replace(/\s+/g, '').toUpperCase();
}

export function getInviteKeyError(status: Exclude<InviteKeyStatus, 'available'>): string {
    if (status === 'used') return 'This invite key has already been used. Ask an admin for a new key.';
    if (status === 'expired') return 'This invite key has expired. Ask an admin for a new key.';
    return 'This invite key is not valid. Check it and try again.';
}
