-- Before the country selector was introduced, Indian users could save a local
-- 10-digit mobile number. Prefix only unambiguous Indian mobile patterns so
-- WhatsApp links receive the required international destination.
update public.user_payment_profiles
set whatsapp_number = '91' || whatsapp_number,
    updated_at = timezone('utc', now())
where whatsapp_number ~ '^[6-9][0-9]{9}$';
