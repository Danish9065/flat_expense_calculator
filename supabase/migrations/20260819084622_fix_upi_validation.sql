-- PostgreSQL's regular-expression engine rejects bounded repetitions whose
-- upper limit exceeds 255. The previous `{2,256}` expression therefore raised
-- SQLSTATE 2201B for every non-null UPI ID instead of validating the value.
-- Keep the same 256-character product limit with explicit length checks.
alter table public.user_payment_profiles
  drop constraint if exists valid_upi_id;

alter table public.user_payment_profiles
  add constraint valid_upi_id check (
    upi_id is null or (
      upi_id ~* '^[A-Z0-9._-]+@[A-Z0-9.-]+$'
      and char_length(split_part(upi_id, '@', 1)) between 2 and 256
      and char_length(split_part(upi_id, '@', 2)) between 2 and 64
    )
  );
