export function generateInviteKey(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let key = 'SPLIT-';
    for (let i = 0; i < 6; i++) {
        key += chars[Math.floor(Math.random() * chars.length)];
    }
    return key; // e.g. SPLIT-K7MN2P
}
