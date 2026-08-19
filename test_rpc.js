import { createClient } from '@insforge/sdk';

const client = createClient({
    baseUrl: process.env.INSFORGE_URL,
    anonKey: process.env.INSFORGE_API_KEY,
});

async function run() {
    const { data, error } = await client.database.rpc('consume_invite_key', {
        key_code_param: 'SPLIT-ELPNDN',
        target_user_id: '12345678-1234-1234-1234-123456789012'
    });
    console.log("RPC Data:", data);
    console.log("RPC Error:", error);
}
run();
