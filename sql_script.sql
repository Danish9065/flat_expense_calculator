-- 1. Create the notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Turn on Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
CREATE POLICY "Users can only view their own notifications"
ON public.notifications FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notifications"
ON public.notifications FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert notifications for their group members" 
ON public.notifications FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM group_members 
        WHERE group_members.group_id = notifications.group_id 
        AND group_members.user_id = auth.uid()
    )
);

-- 4. Notification Trigger Function for Expenses
CREATE OR REPLACE FUNCTION notify_expense_action()
RETURNS TRIGGER AS $$
DECLARE
    member_record RECORD;
    actor_name TEXT;
    action_verb TEXT;
BEGIN
    -- Get actor name
    SELECT full_name INTO actor_name FROM public.users WHERE id = COALESCE(NEW.added_by, OLD.added_by);
    
    IF TG_OP = 'INSERT' THEN
        action_verb := 'added a new expense:';
    ELSIF TG_OP = 'UPDATE' THEN
        action_verb := 'updated the expense:';
    ELSIF TG_OP = 'DELETE' THEN
        action_verb := 'deleted the expense:';
    END IF;

    -- Loop through all group members to notify them
    FOR member_record IN
        SELECT user_id FROM public.group_members 
        WHERE group_id = COALESCE(NEW.group_id, OLD.group_id) 
        AND user_id != COALESCE(NEW.added_by, OLD.added_by)
    LOOP
        INSERT INTO public.notifications (user_id, group_id, actor_id, type, message)
        VALUES (
            member_record.user_id,
            COALESCE(NEW.group_id, OLD.group_id),
            COALESCE(NEW.added_by, OLD.added_by),
            TG_OP || '_expense',
            actor_name || ' ' || action_verb || ' "' || COALESCE(NEW.item_name, OLD.item_name) || '" for ₹' || COALESCE(NEW.amount, OLD.amount) || '.'
        );
    END LOOP;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Attach Triggers to Expenses Table
DROP TRIGGER IF EXISTS trg_notify_expense ON public.expenses;
CREATE TRIGGER trg_notify_expense
AFTER INSERT OR UPDATE OR DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION notify_expense_action();

-- 6. Notification Trigger Function for Settlements
CREATE OR REPLACE FUNCTION notify_settlement_action()
RETURNS TRIGGER AS $$
DECLARE
    debtor_name TEXT;
BEGIN
    SELECT full_name INTO debtor_name FROM public.users WHERE id = NEW.from_user_id;

    -- Notify the Creditor (to_user_id) that Debtor settled
    INSERT INTO public.notifications (user_id, group_id, actor_id, type, message)
    VALUES (
        NEW.to_user_id,
        NEW.group_id,
        NEW.from_user_id,
        'SETTLEMENT',
        debtor_name || ' confirmed a settlement payment of ₹' || NEW.amount || ' to you for ' || COALESCE(NEW.category, 'General') || '.'
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Attach Trigger to Settlements Table
DROP TRIGGER IF EXISTS trg_notify_settlement ON public.settlements;
CREATE TRIGGER trg_notify_settlement
AFTER INSERT ON public.settlements
FOR EACH ROW EXECUTE FUNCTION notify_settlement_action();

