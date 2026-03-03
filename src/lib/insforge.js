import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY
});

export const insforge = client;
export default client;

export async function dbQuery(table, params = '') {
  const saved = localStorage.getItem('splitmate-user');
  const token = saved ? JSON.parse(saved).token : null;
  const res = await fetch(
    `${import.meta.env.VITE_INSFORGE_URL}/api/db/${table}${params ? '?' + params : ''}`,
    {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function dbInsert(table, body) {
  const saved = localStorage.getItem('splitmate-user');
  const token = saved ? JSON.parse(saved).token : null;
  const res = await fetch(
    `${import.meta.env.VITE_INSFORGE_URL}/api/db/${table}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function dbUpdate(table, params, body) {
  const saved = localStorage.getItem('splitmate-user');
  const token = saved ? JSON.parse(saved).token : null;
  const res = await fetch(
    `${import.meta.env.VITE_INSFORGE_URL}/api/db/${table}?${params}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function dbDelete(table, params) {
  const saved = localStorage.getItem('splitmate-user');
  const token = saved ? JSON.parse(saved).token : null;
  const res = await fetch(
    `${import.meta.env.VITE_INSFORGE_URL}/api/db/${table}?${params}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
