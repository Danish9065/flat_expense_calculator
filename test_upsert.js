import { createClient } from '@insforge/sdk';

const client = createClient({
    baseUrl: process.env.INSFORGE_URL,
    anonKey: process.env.INSFORGE_API_KEY,
});

async function run() {
    const { data, error } = await client.database.from('users').upsert({
        id: '12345678-1234-1234-1234-123456789012',
        full_name: 'Test Setup',
        email: 'test@example.com',
        role: 'member'
    });
    console.log("Upsert Data:", data);
    console.log("Upsert Error:", error);
}
run();
