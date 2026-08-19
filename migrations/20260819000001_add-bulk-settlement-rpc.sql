-- Atomically records one confirmed combined payment across its source groups.
CREATE OR REPLACE FUNCTION public.record_group_settlements_batch(p_payments JSONB)
RETURNS SETOF public.settlements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    payment JSONB;
    payment_group_id UUID;
    payment_debtor_id UUID;
    payment_amount NUMERIC;
    inserted_settlement public.settlements%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    IF jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
        RAISE EXCEPTION 'At least one payment allocation is required';
    END IF;

    FOR payment IN SELECT value FROM jsonb_array_elements(p_payments)
    LOOP
        payment_group_id := (payment->>'group_id')::UUID;
        payment_debtor_id := (payment->>'debtor_id')::UUID;
        payment_amount := round((payment->>'amount')::NUMERIC, 2);

        IF payment_amount <= 0 THEN RAISE EXCEPTION 'Payment amounts must be positive'; END IF;
        IF payment_debtor_id = auth.uid() THEN RAISE EXCEPTION 'Payer and receiver must be different'; END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.group_members
            WHERE group_id = payment_group_id AND user_id = auth.uid()
        ) OR NOT EXISTS (
            SELECT 1 FROM public.group_members
            WHERE group_id = payment_group_id AND user_id = payment_debtor_id
        ) THEN
            RAISE EXCEPTION 'Both payment parties must belong to the source group';
        END IF;

        INSERT INTO public.settlements (group_id, paid_by, paid_to, amount, settled_at, is_partial)
        VALUES (payment_group_id, payment_debtor_id, auth.uid(), payment_amount, timezone('utc'::text, now()), FALSE)
        RETURNING * INTO inserted_settlement;
        RETURN NEXT inserted_settlement;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.record_group_settlements_batch(JSONB) IS
'Records a creditor-confirmed payment across multiple shared groups in one transaction.';
