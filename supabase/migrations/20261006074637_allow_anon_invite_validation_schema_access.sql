-- Public invite-check wrappers execute these two tightly scoped private
-- functions before a user has authenticated. EXECUTE alone is insufficient:
-- Postgres also requires USAGE on the containing schema.
grant usage on schema private to anon;

-- Keep the anonymous role limited to read-only invite validation. All other
-- private functions remain non-executable by anon.
revoke execute on all functions in schema private from anon;
grant execute on function private.validate_invite_key(text) to anon;
grant execute on function private.invite_key_status(text) to anon;

notify pgrst, 'reload schema';
