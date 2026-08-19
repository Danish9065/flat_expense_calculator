-- Optional contact and payment details used only between members who share a group.
CREATE TABLE IF NOT EXISTS public.user_payment_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    whatsapp_number TEXT,
    upi_id TEXT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT valid_whatsapp_number CHECK (
        whatsapp_number IS NULL OR whatsapp_number ~ '^[1-9][0-9]{7,14}$'
    ),
    CONSTRAINT valid_upi_id CHECK (
        upi_id IS NULL OR upi_id ~* '^[A-Z0-9._-]{2,256}@[A-Z0-9.-]{2,64}$'
    )
);

ALTER TABLE public.user_payment_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own payment profile" ON public.user_payment_profiles;
CREATE POLICY "Users manage their own payment profile"
ON public.user_payment_profiles
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Group members can view payment profiles" ON public.user_payment_profiles;
CREATE POLICY "Group members can view payment profiles"
ON public.user_payment_profiles
FOR SELECT
USING (
    auth.uid() = user_id
    OR EXISTS (
        SELECT 1
        FROM public.group_members viewer_membership
        JOIN public.group_members profile_membership
          ON profile_membership.group_id = viewer_membership.group_id
        WHERE viewer_membership.user_id = auth.uid()
          AND profile_membership.user_id = user_payment_profiles.user_id
    )
);

COMMENT ON TABLE public.user_payment_profiles IS
'Optional WhatsApp and UPI identifiers. RLS limits reads to the owner and members of a shared expense group.';
