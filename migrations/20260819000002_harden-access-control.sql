-- Production access-control hardening for the shared expense data model.
-- SECURITY DEFINER helpers avoid recursive RLS evaluation.

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_group_member(target_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = target_group_id AND user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_owns_group(target_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = target_group_id AND created_by = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_shares_group_with(target_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT target_user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1
    FROM public.group_members mine
    JOIN public.group_members theirs ON theirs.group_id = mine.group_id
    WHERE mine.user_id = (SELECT auth.uid()) AND theirs.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_expense(target_expense_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.current_user_is_admin() OR EXISTS (
    SELECT 1 FROM public.expenses
    WHERE id = target_expense_id
      AND (added_by = (SELECT auth.uid()) OR public.current_user_owns_group(group_id))
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_is_group_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_owns_group(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_shares_group_with(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_manage_expense(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated, project_admin;
GRANT EXECUTE ON FUNCTION public.current_user_is_group_member(UUID) TO authenticated, project_admin;
GRANT EXECUTE ON FUNCTION public.current_user_owns_group(UUID) TO authenticated, project_admin;
GRANT EXECUTE ON FUNCTION public.current_user_shares_group_with(UUID) TO authenticated, project_admin;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_expense(UUID) TO authenticated, project_admin;

CREATE OR REPLACE FUNCTION public.validate_invite_key(key_code_param TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invite_keys
    WHERE key_code = upper(trim(key_code_param))
      AND is_used = false AND (expires_at IS NULL OR expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.consume_invite_key(key_code_param TEXT, target_user_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE changed_rows INTEGER;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR target_user_id <> (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Invite keys can only be consumed for the authenticated user';
  END IF;
  UPDATE public.invite_keys
  SET is_used = true, used_by = target_user_id, used_at = now()
  WHERE key_code = upper(trim(key_code_param))
    AND is_used = false AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN RAISE EXCEPTION 'Invalid or already used invite key'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_group_by_invite_code(invite_code_param TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE target_group_id UUID;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO target_group_id FROM public.groups
  WHERE invite_code = upper(trim(invite_code_param));
  IF target_group_id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (target_group_id, (SELECT auth.uid()))
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN target_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user_completely(target_user_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF target_user_id = (SELECT auth.uid()) THEN RAISE EXCEPTION 'Administrators cannot delete themselves'; END IF;
  UPDATE public.groups SET created_by = NULL WHERE created_by = target_user_id;
  UPDATE public.invite_keys SET used_by = NULL WHERE used_by = target_user_id;
  UPDATE public.invite_keys SET created_by = NULL WHERE created_by = target_user_id;
  DELETE FROM public.settlements WHERE paid_by = target_user_id OR paid_to = target_user_id;
  DELETE FROM public.expenses WHERE added_by = target_user_id;
  DELETE FROM public.expense_splits WHERE user_id = target_user_id;
  DELETE FROM public.group_members WHERE user_id = target_user_id;
  DELETE FROM public.users WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_invite_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_invite_key(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_group_by_invite_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_user_completely(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_group_settlements_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invite_key(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invite_key(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_by_invite_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_completely(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_group_settlements_batch(JSONB) TO authenticated;

DO $$
DECLARE policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('users','groups','group_members','invite_keys','expenses','expense_splits','settlements','notifications','user_payment_profiles')
      AND policyname <> 'project_admin_policy'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_record.policyname, policy_record.tablename);
  END LOOP;
END;
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_payment_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
USING (public.current_user_is_admin() OR public.current_user_shares_group_with(id));
CREATE POLICY users_insert ON public.users FOR INSERT TO authenticated
WITH CHECK (id = (SELECT auth.uid()) AND coalesce(role, 'member') = 'member');
CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY users_delete ON public.users FOR DELETE TO authenticated
USING (public.current_user_is_admin() AND id <> (SELECT auth.uid()));

CREATE POLICY groups_select ON public.groups FOR SELECT TO authenticated
USING (public.current_user_is_admin() OR created_by = (SELECT auth.uid()) OR public.current_user_is_group_member(id));
CREATE POLICY groups_insert ON public.groups FOR INSERT TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()));
CREATE POLICY groups_update ON public.groups FOR UPDATE TO authenticated
USING (public.current_user_is_admin() OR created_by = (SELECT auth.uid()))
WITH CHECK (public.current_user_is_admin() OR created_by = (SELECT auth.uid()));
CREATE POLICY groups_delete ON public.groups FOR DELETE TO authenticated
USING (public.current_user_is_admin() OR created_by = (SELECT auth.uid()));

CREATE POLICY group_members_select ON public.group_members FOR SELECT TO authenticated
USING (public.current_user_is_admin() OR public.current_user_owns_group(group_id) OR public.current_user_is_group_member(group_id));
CREATE POLICY group_members_insert ON public.group_members FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_admin() OR (user_id = (SELECT auth.uid()) AND public.current_user_owns_group(group_id)));
CREATE POLICY group_members_delete ON public.group_members FOR DELETE TO authenticated
USING (public.current_user_is_admin() OR user_id = (SELECT auth.uid()) OR public.current_user_owns_group(group_id));

CREATE POLICY invite_keys_admin ON public.invite_keys FOR ALL TO authenticated
USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());

CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated
USING (public.current_user_is_admin() OR public.current_user_owns_group(group_id) OR public.current_user_is_group_member(group_id));
CREATE POLICY expenses_insert ON public.expenses FOR INSERT TO authenticated
WITH CHECK (added_by = (SELECT auth.uid()) AND public.current_user_is_group_member(group_id));
CREATE POLICY expenses_update ON public.expenses FOR UPDATE TO authenticated
USING (public.current_user_is_admin() OR added_by = (SELECT auth.uid()) OR public.current_user_owns_group(group_id))
WITH CHECK (public.current_user_is_admin() OR added_by = (SELECT auth.uid()) OR public.current_user_owns_group(group_id));
CREATE POLICY expenses_delete ON public.expenses FOR DELETE TO authenticated
USING (public.current_user_is_admin() OR added_by = (SELECT auth.uid()) OR public.current_user_owns_group(group_id));

CREATE POLICY expense_splits_select ON public.expense_splits FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.expenses e WHERE e.id = expense_id
    AND (public.current_user_is_admin() OR public.current_user_owns_group(e.group_id) OR public.current_user_is_group_member(e.group_id))
));
CREATE POLICY expense_splits_insert ON public.expense_splits FOR INSERT TO authenticated
WITH CHECK (public.current_user_can_manage_expense(expense_id));
CREATE POLICY expense_splits_update ON public.expense_splits FOR UPDATE TO authenticated
USING (public.current_user_can_manage_expense(expense_id)) WITH CHECK (public.current_user_can_manage_expense(expense_id));
CREATE POLICY expense_splits_delete ON public.expense_splits FOR DELETE TO authenticated
USING (public.current_user_can_manage_expense(expense_id));

CREATE POLICY settlements_select ON public.settlements FOR SELECT TO authenticated
USING (public.current_user_is_admin() OR public.current_user_owns_group(group_id) OR public.current_user_is_group_member(group_id));
CREATE POLICY settlements_insert ON public.settlements FOR INSERT TO authenticated
WITH CHECK (
  paid_to = (SELECT auth.uid()) AND paid_by <> paid_to
  AND public.current_user_is_group_member(group_id)
  AND EXISTS (SELECT 1 FROM public.group_members WHERE group_id = settlements.group_id AND user_id = settlements.paid_by)
);
CREATE POLICY settlements_delete ON public.settlements FOR DELETE TO authenticated
USING (public.current_user_is_admin() OR public.current_user_owns_group(group_id));

CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY payment_profiles_select ON public.user_payment_profiles FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.current_user_shares_group_with(user_id));
CREATE POLICY payment_profiles_insert ON public.user_payment_profiles FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY payment_profiles_update ON public.user_payment_profiles FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY payment_profiles_delete ON public.user_payment_profiles FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.users, public.groups, public.group_members, public.invite_keys, public.expenses,
  public.expense_splits, public.settlements, public.notifications, public.user_payment_profiles FROM anon;
REVOKE UPDATE ON public.users, public.groups, public.expenses, public.notifications FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.users TO authenticated;
GRANT UPDATE (full_name, email, avatar_url, currency) ON public.users TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.groups, public.expenses, public.notifications TO authenticated;
GRANT UPDATE (name, invite_code) ON public.groups TO authenticated;
GRANT UPDATE (category, item_name, amount, note, receipt_url, is_recurring, recur_type, updated_at) ON public.expenses TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_members, public.invite_keys,
  public.expense_splits, public.settlements, public.user_payment_profiles TO authenticated;

CREATE INDEX IF NOT EXISTS idx_groups_created_by ON public.groups(created_by);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_invite_keys_created_by ON public.invite_keys(created_by);
CREATE INDEX IF NOT EXISTS idx_invite_keys_used_by ON public.invite_keys(used_by);
CREATE INDEX IF NOT EXISTS idx_expenses_group_id ON public.expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_added_by ON public.expenses(added_by);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense_id ON public.expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user_id ON public.expense_splits(user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_group_id ON public.settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_settlements_paid_by ON public.settlements(paid_by);
CREATE INDEX IF NOT EXISTS idx_settlements_paid_to ON public.settlements(paid_to);
CREATE INDEX IF NOT EXISTS idx_notifications_actor_id ON public.notifications(actor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_group_id ON public.notifications(group_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);

COMMENT ON FUNCTION public.join_group_by_invite_code(TEXT) IS
'Adds only the authenticated user to a group matching an exact invite code without exposing group rows.';
