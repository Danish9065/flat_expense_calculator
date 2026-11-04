export function generateInviteKey(): string {
    // 12 base32 characters = 60 random bits, within the database's varchar(12).
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => chars[byte & 31]).join('');
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
