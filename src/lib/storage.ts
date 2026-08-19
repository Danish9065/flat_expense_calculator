import { supabaseClient } from './db';

const STORAGE_REFERENCE_PREFIX = 'supabase-storage://';

export function createStorageReference(bucket: string, path: string) {
  return `${STORAGE_REFERENCE_PREFIX}${bucket}/${encodeURIComponent(path)}`;
}

export function parseStorageReference(reference?: string | null) {
  if (!reference?.startsWith(STORAGE_REFERENCE_PREFIX)) return null;
  const value = reference.slice(STORAGE_REFERENCE_PREFIX.length);
  const separator = value.indexOf('/');
  if (separator <= 0) return null;
  return {
    bucket: value.slice(0, separator),
    path: decodeURIComponent(value.slice(separator + 1)),
  };
}

export function safeStorageFileName(fileName: string) {
  return fileName.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
}

export async function uploadPrivateFile(bucket: string, path: string, file: File) {
  const { error } = await supabaseClient.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return createStorageReference(bucket, path);
}

export async function getSignedStorageUrl(reference: string, expiresIn = 3600) {
  const parsed = parseStorageReference(reference);
  if (!parsed) return reference;
  const { data, error } = await supabaseClient.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteStorageReference(reference?: string | null) {
  const parsed = parseStorageReference(reference);
  if (!parsed) return;
  const { error } = await supabaseClient.storage.from(parsed.bucket).remove([parsed.path]);
  if (error) throw error;
}
