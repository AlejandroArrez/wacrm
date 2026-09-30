-- ============================================================
-- 043_prospect_ownership
--
-- Each advisor (role 'agent') sees only the prospects they own.
-- Owners, admins and viewers keep seeing the whole account.
--
-- Rules (Porta Magna playbook, confirmed 30 sep 2026):
--   * A prospect belongs to the first advisor who registers it.
--   * Ownership lasts N days (default 60) from the owner's last
--     activity. Activity = a message the owner sends, a note the
--     owner writes, or a deal the owner moves. Customer and bot
--     messages do not count.
--   * When ownership lapses the prospect goes back to "no owner":
--     the advisor stops seeing it and an admin reassigns it.
--   * Leads without an advisor (landing, AI agent) stay unowned
--     until an admin assigns them.
--   * A lead tagged `asesor:CLAVE` (sent by the WordPress
--     connector) is assigned to the member whose advisor_code is
--     CLAVE, when the contact has no current owner.
--
-- Additive only. No table or column is renamed or dropped.
-- Visibility is evaluated at read time, so expiry needs no cron.
-- Service-role code (webhook, public API, AI, automations) bypasses
-- RLS exactly as before.
-- ============================================================

-- ------------------------------------------------------------
-- 1 · Columns
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS prospect_ownership_days INTEGER NOT NULL DEFAULT 60
  CHECK (prospect_ownership_days BETWEEN 1 AND 3650);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS advisor_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_account_advisor_code
  ON profiles (account_id, upper(advisor_code))
  WHERE advisor_code IS NOT NULL AND advisor_code <> '';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_last_activity_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_account_owner ON contacts (account_id, owner_id);

-- ------------------------------------------------------------
-- 2 · Helpers (SECURITY DEFINER: they read profiles/contacts
--     without recursing into the policies below)
-- ------------------------------------------------------------

-- Caller's role in an account, or NULL when not a member.
CREATE OR REPLACE FUNCTION public.caller_account_role(p_account_id UUID)
RETURNS account_role_enum
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.account_role FROM profiles p
  WHERE p.user_id = auth.uid() AND p.account_id = p_account_id
  LIMIT 1;
$$;

-- True when the caller sees every prospect of the account.
-- Only role 'agent' is restricted to its own prospects.
CREATE OR REPLACE FUNCTION public.sees_all_prospects(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(public.caller_account_role(p_account_id) IN ('owner', 'admin', 'viewer'), false);
$$;

-- True while an ownership is still inside its window.
CREATE OR REPLACE FUNCTION public.prospect_owner_current(
  p_account_id UUID,
  p_owner_id UUID,
  p_assigned_at TIMESTAMPTZ,
  p_last_activity_at TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_owner_id IS NOT NULL
     -- An owner who left the account no longer holds prospects.
     AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = p_owner_id AND p.account_id = p_account_id)
     AND GREATEST(COALESCE(p_assigned_at, '-infinity'), COALESCE(p_last_activity_at, '-infinity'))
         > now() - make_interval(days => COALESCE(
             (SELECT a.prospect_ownership_days FROM accounts a WHERE a.id = p_account_id), 60));
$$;

-- Date on which the current ownership lapses (NULL when unowned).
CREATE OR REPLACE FUNCTION public.prospect_owner_expires_at(
  p_account_id UUID,
  p_owner_id UUID,
  p_assigned_at TIMESTAMPTZ,
  p_last_activity_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN p_owner_id IS NULL THEN NULL ELSE
    GREATEST(COALESCE(p_assigned_at, '-infinity'), COALESCE(p_last_activity_at, '-infinity'))
    + make_interval(days => COALESCE(
        (SELECT a.prospect_ownership_days FROM accounts a WHERE a.id = p_account_id), 60))
  END;
$$;

-- Row-level visibility of one contact for the caller.
CREATE OR REPLACE FUNCTION public.contact_visible(p_contact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = p_contact_id
      AND is_account_member(c.account_id)
      AND ( public.sees_all_prospects(c.account_id)
            OR ( c.owner_id = auth.uid()
                 AND public.prospect_owner_current(c.account_id, c.owner_id,
                                                   c.owner_assigned_at, c.owner_last_activity_at) ) )
  );
$$;

-- Visibility of one conversation: its contact is visible, or it is
-- explicitly assigned to the caller.
CREATE OR REPLACE FUNCTION public.conversation_visible(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations v
    WHERE v.id = p_conversation_id
      AND is_account_member(v.account_id)
      AND ( public.sees_all_prospects(v.account_id)
            OR v.assigned_agent_id = auth.uid()
            OR public.contact_visible(v.contact_id) )
  );
$$;

-- Caller's profile id (deals.assigned_to points at profiles.id).
CREATE OR REPLACE FUNCTION public.caller_profile_id(p_account_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id FROM profiles p
  WHERE p.user_id = auth.uid() AND p.account_id = p_account_id
  LIMIT 1;
$$;

ALTER FUNCTION public.caller_account_role(UUID) OWNER TO postgres;
ALTER FUNCTION public.sees_all_prospects(UUID) OWNER TO postgres;
ALTER FUNCTION public.prospect_owner_current(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION public.prospect_owner_expires_at(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION public.contact_visible(UUID) OWNER TO postgres;
ALTER FUNCTION public.conversation_visible(UUID) OWNER TO postgres;
ALTER FUNCTION public.caller_profile_id(UUID) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.caller_account_role(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sees_all_prospects(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prospect_owner_current(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prospect_owner_expires_at(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_visible(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_visible(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caller_profile_id(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3 · Policies
-- ------------------------------------------------------------

-- contacts
DROP POLICY IF EXISTS contacts_select ON contacts;
DROP POLICY IF EXISTS contacts_insert ON contacts;
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (
  is_account_member(account_id)
  AND ( sees_all_prospects(account_id)
        OR ( owner_id = auth.uid()
             AND prospect_owner_current(account_id, owner_id, owner_assigned_at, owner_last_activity_at) ) )
);
CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id) OR owner_id = auth.uid() )
);
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id)
        OR ( owner_id = auth.uid()
             AND prospect_owner_current(account_id, owner_id, owner_assigned_at, owner_last_activity_at) ) )
);
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id)
        OR ( owner_id = auth.uid()
             AND prospect_owner_current(account_id, owner_id, owner_assigned_at, owner_last_activity_at) ) )
);

-- contact_notes
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
DROP POLICY IF EXISTS contact_notes_insert ON contact_notes;
DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT USING (
  is_account_member(account_id) AND contact_visible(contact_id));
CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent') AND contact_visible(contact_id));
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE USING (
  is_account_member(account_id, 'agent') AND contact_visible(contact_id));
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE USING (
  is_account_member(account_id, 'agent') AND contact_visible(contact_id));

-- contact_tags
DROP POLICY IF EXISTS contact_tags_select ON contact_tags;
DROP POLICY IF EXISTS contact_tags_modify ON contact_tags;
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (contact_visible(contact_id));
CREATE POLICY contact_tags_modify ON contact_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'agent'))
  AND contact_visible(contact_id)
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'agent'))
  AND contact_visible(contact_id)
);

-- contact_custom_values
DROP POLICY IF EXISTS contact_custom_values_select ON contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_modify ON contact_custom_values;
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (contact_visible(contact_id));
CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'agent'))
  AND contact_visible(contact_id)
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'agent'))
  AND contact_visible(contact_id)
);

-- conversations
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  is_account_member(account_id)
  AND ( sees_all_prospects(account_id) OR assigned_agent_id = auth.uid() OR contact_visible(contact_id) ));
CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id) OR contact_visible(contact_id) ));
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id) OR assigned_agent_id = auth.uid() OR contact_visible(contact_id) ));
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id) OR assigned_agent_id = auth.uid() OR contact_visible(contact_id) ));

-- messages
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (conversation_visible(conversation_id));
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
  AND conversation_visible(conversation_id)
) WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
  AND conversation_visible(conversation_id)
);

-- deals
DROP POLICY IF EXISTS deals_select ON deals;
DROP POLICY IF EXISTS deals_insert ON deals;
DROP POLICY IF EXISTS deals_update ON deals;
DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_select ON deals FOR SELECT USING (
  is_account_member(account_id)
  AND ( sees_all_prospects(account_id)
        OR assigned_to = caller_profile_id(account_id)
        OR (contact_id IS NOT NULL AND contact_visible(contact_id)) ));
CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id)
        OR assigned_to = caller_profile_id(account_id)
        OR (contact_id IS NOT NULL AND contact_visible(contact_id)) ));
CREATE POLICY deals_update ON deals FOR UPDATE USING (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id)
        OR assigned_to = caller_profile_id(account_id)
        OR (contact_id IS NOT NULL AND contact_visible(contact_id)) ));
CREATE POLICY deals_delete ON deals FOR DELETE USING (
  is_account_member(account_id, 'agent')
  AND ( sees_all_prospects(account_id)
        OR assigned_to = caller_profile_id(account_id)
        OR (contact_id IS NOT NULL AND contact_visible(contact_id)) ));

-- ------------------------------------------------------------
-- 4 · Triggers
-- ------------------------------------------------------------

-- 4.1 contacts: owner on insert, owner changes reserved to admins.
CREATE OR REPLACE FUNCTION public.contacts_ownership_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_restricted BOOLEAN;
BEGIN
  -- Only user sessions are policed. Service-role code (webhook, public
  -- API, AI, automations) has no auth.uid() and passes through.
  v_restricted := auth.uid() IS NOT NULL AND NOT public.sees_all_prospects(NEW.account_id);

  IF TG_OP = 'INSERT' THEN
    IF v_restricted THEN
      -- An advisor who registers a prospect owns it.
      NEW.owner_id := auth.uid();
    END IF;
    IF NEW.owner_id IS NOT NULL THEN
      NEW.owner_assigned_at := COALESCE(NEW.owner_assigned_at, now());
      NEW.owner_last_activity_at := COALESCE(NEW.owner_last_activity_at, now());
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    IF v_restricted THEN
      RAISE EXCEPTION 'Only an admin can change the owner of a prospect'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.owner_id IS NULL THEN
      NEW.owner_assigned_at := NULL;
      NEW.owner_last_activity_at := NULL;
    ELSE
      -- A (re)assignment starts a fresh window.
      NEW.owner_assigned_at := now();
      NEW.owner_last_activity_at := now();
    END IF;
  ELSIF v_restricted
        AND COALESCE(current_setting('strato.owner_touch', true), '') <> '1'
        AND ( NEW.owner_assigned_at IS DISTINCT FROM OLD.owner_assigned_at
              OR NEW.owner_last_activity_at IS DISTINCT FROM OLD.owner_last_activity_at ) THEN
    -- Advisors cannot extend their own window by hand.
    NEW.owner_assigned_at := OLD.owner_assigned_at;
    NEW.owner_last_activity_at := OLD.owner_last_activity_at;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.contacts_ownership_guard() OWNER TO postgres;
DROP TRIGGER IF EXISTS contacts_ownership_guard ON contacts;
CREATE TRIGGER contacts_ownership_guard
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_ownership_guard();

-- 4.2 Activity by the current owner restarts the window.
CREATE OR REPLACE FUNCTION public.touch_prospect_owner(p_contact_id UUID, p_actor UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_contact_id IS NULL OR p_actor IS NULL THEN
    RETURN;
  END IF;
  -- Lets the guard trigger accept this one system-made change.
  PERFORM set_config('strato.owner_touch', '1', true);
  UPDATE contacts c
     SET owner_last_activity_at = now()
   WHERE c.id = p_contact_id
     AND c.owner_id = p_actor
     AND public.prospect_owner_current(c.account_id, c.owner_id, c.owner_assigned_at, c.owner_last_activity_at);
  PERFORM set_config('strato.owner_touch', '', true);
END;
$$;
ALTER FUNCTION public.touch_prospect_owner(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.touch_prospect_owner(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Messages sent by an advisor from the inbox. The send route writes
-- with the user's session, so auth.uid() is the advisor. API, AI and
-- automation sends run as service role and do not count.
CREATE OR REPLACE FUNCTION public.messages_fill_sender()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'agent' AND NEW.sender_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.sender_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS messages_fill_sender ON messages;
CREATE TRIGGER messages_fill_sender
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_fill_sender();

CREATE OR REPLACE FUNCTION public.messages_touch_owner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_contact UUID;
BEGIN
  IF NEW.sender_type = 'agent' AND NEW.sender_id IS NOT NULL
     AND COALESCE(NEW.ai_generated, false) = false THEN
    SELECT contact_id INTO v_contact FROM conversations WHERE id = NEW.conversation_id;
    PERFORM public.touch_prospect_owner(v_contact, NEW.sender_id);
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.messages_touch_owner() OWNER TO postgres;
DROP TRIGGER IF EXISTS messages_touch_owner ON messages;
CREATE TRIGGER messages_touch_owner
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_touch_owner();

-- Notes written by the owner.
CREATE OR REPLACE FUNCTION public.contact_notes_touch_owner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.touch_prospect_owner(NEW.contact_id, NEW.user_id);
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.contact_notes_touch_owner() OWNER TO postgres;
DROP TRIGGER IF EXISTS contact_notes_touch_owner ON contact_notes;
CREATE TRIGGER contact_notes_touch_owner
  AFTER INSERT ON contact_notes
  FOR EACH ROW EXECUTE FUNCTION public.contact_notes_touch_owner();

-- Deals moved by the owner (stage or status change).
CREATE OR REPLACE FUNCTION public.deals_touch_owner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND auth.uid() IS NOT NULL
     AND ( TG_OP = 'INSERT'
           OR NEW.stage_id IS DISTINCT FROM OLD.stage_id
           OR NEW.status IS DISTINCT FROM OLD.status ) THEN
    PERFORM public.touch_prospect_owner(NEW.contact_id, auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.deals_touch_owner() OWNER TO postgres;
DROP TRIGGER IF EXISTS deals_touch_owner ON deals;
CREATE TRIGGER deals_touch_owner
  AFTER INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_touch_owner();

-- 4.3 Deals created by an advisor without an assignee are theirs.
CREATE OR REPLACE FUNCTION public.deals_default_assignee()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NULL AND auth.uid() IS NOT NULL
     AND NOT public.sees_all_prospects(NEW.account_id) THEN
    NEW.assigned_to := public.caller_profile_id(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.deals_default_assignee() OWNER TO postgres;
DROP TRIGGER IF EXISTS deals_default_assignee ON deals;
CREATE TRIGGER deals_default_assignee
  BEFORE INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_default_assignee();

-- 4.4 Assigning a conversation to an advisor:
--     * by an admin → the advisor becomes the prospect's owner
--       (otherwise the advisor would see the chat but not the
--       contact);
--     * by the system (AI handoff) → only when nobody owns it;
--     * by another advisor → the owner does not change.
CREATE OR REPLACE FUNCTION public.conversations_assign_owner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role account_role_enum;
BEGIN
  IF NEW.assigned_agent_id IS NULL
     OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NULL;
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.sees_all_prospects(NEW.account_id) THEN
    RETURN NULL;
  END IF;
  SELECT account_role INTO v_role FROM profiles
   WHERE user_id = NEW.assigned_agent_id AND account_id = NEW.account_id;
  IF v_role IS DISTINCT FROM 'agent' THEN
    RETURN NULL;
  END IF;
  UPDATE contacts c
     SET owner_id = NEW.assigned_agent_id
   WHERE c.id = NEW.contact_id
     AND c.owner_id IS DISTINCT FROM NEW.assigned_agent_id
     AND ( auth.uid() IS NOT NULL
           OR NOT public.prospect_owner_current(c.account_id, c.owner_id, c.owner_assigned_at, c.owner_last_activity_at) );
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.conversations_assign_owner() OWNER TO postgres;
DROP TRIGGER IF EXISTS conversations_assign_owner ON conversations;
CREATE TRIGGER conversations_assign_owner
  AFTER UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_assign_owner();

-- 4.5 Tag `asesor:CLAVE` from the WordPress connector.
CREATE OR REPLACE FUNCTION public.contact_tags_assign_owner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tag TEXT;
  v_account UUID;
  v_user UUID;
BEGIN
  SELECT t.name, t.account_id INTO v_tag, v_account FROM tags t WHERE t.id = NEW.tag_id;
  IF v_tag IS NULL OR lower(v_tag) NOT LIKE 'asesor:%' THEN
    RETURN NULL;
  END IF;
  SELECT p.user_id INTO v_user FROM profiles p
   WHERE p.account_id = v_account
     AND p.advisor_code IS NOT NULL
     AND upper(p.advisor_code) = upper(trim(substr(v_tag, 8)))
   LIMIT 1;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE contacts c
     SET owner_id = v_user
   WHERE c.id = NEW.contact_id
     AND c.account_id = v_account
     AND NOT public.prospect_owner_current(c.account_id, c.owner_id, c.owner_assigned_at, c.owner_last_activity_at);
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.contact_tags_assign_owner() OWNER TO postgres;
DROP TRIGGER IF EXISTS contact_tags_assign_owner ON contact_tags;
CREATE TRIGGER contact_tags_assign_owner
  AFTER INSERT ON contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.contact_tags_assign_owner();

-- 4.6 Advisors cannot change their own advisor code.
CREATE OR REPLACE FUNCTION public.profiles_advisor_code_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.advisor_code IS DISTINCT FROM OLD.advisor_code
     AND auth.uid() IS NOT NULL
     AND NOT is_account_member(NEW.account_id, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can change an advisor code' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_advisor_code_guard ON profiles;
CREATE TRIGGER profiles_advisor_code_guard
  BEFORE UPDATE OF advisor_code ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_advisor_code_guard();

-- ------------------------------------------------------------
-- 5 · Admin RPCs
-- ------------------------------------------------------------

-- Assign (or clear, with NULL) the owner of a prospect.
CREATE OR REPLACE FUNCTION public.set_prospect_owner(p_contact_id UUID, p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM contacts WHERE id = p_contact_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Contact not found' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;
  IF p_owner_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM profiles WHERE user_id = p_owner_id AND account_id = v_account) THEN
    RAISE EXCEPTION 'The new owner is not a member of this account' USING ERRCODE = '22023';
  END IF;
  -- Direct UPDATE: the guard trigger restamps the window.
  UPDATE contacts SET owner_id = p_owner_id WHERE id = p_contact_id;
  -- Same owner again = renew the window.
  UPDATE contacts SET owner_assigned_at = now(), owner_last_activity_at = now()
   WHERE id = p_contact_id AND owner_id IS NOT NULL AND owner_id = p_owner_id;
END;
$$;
ALTER FUNCTION public.set_prospect_owner(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.set_prospect_owner(UUID, UUID) TO authenticated;

-- Set a member's advisor code (same code as in the WordPress plugin).
CREATE OR REPLACE FUNCTION public.set_member_advisor_code(p_user_id UUID, p_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_code TEXT := NULLIF(upper(trim(COALESCE(p_code, ''))), '');
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;
  IF v_code IS NOT NULL AND v_code !~ '^[A-Z0-9_-]{2,30}$' THEN
    RAISE EXCEPTION 'Invalid advisor code' USING ERRCODE = '22023';
  END IF;
  UPDATE profiles SET advisor_code = v_code WHERE user_id = p_user_id;
END;
$$;
ALTER FUNCTION public.set_member_advisor_code(UUID, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.set_member_advisor_code(UUID, TEXT) TO authenticated;

-- Tell an advisor, without revealing the prospect, whether a phone
-- is already registered in the account. Used when an insert fails
-- on the phone uniqueness constraint.
CREATE OR REPLACE FUNCTION public.phone_registration_status(p_phone TEXT)
RETURNS TEXT   -- 'free' | 'yours' | 'taken'
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_digits TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  c RECORD;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = auth.uid();
  IF v_account IS NULL OR length(v_digits) < 10 THEN
    RETURN 'free';
  END IF;
  -- Compare the last 10 digits: 378 000 0002, 523780000002 and
  -- 5213780000002 are the same Mexican mobile.
  SELECT * INTO c FROM contacts
   WHERE account_id = v_account
     AND right(phone_normalized, 10) = right(v_digits, 10)
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN 'free';
  END IF;
  IF c.owner_id = auth.uid()
     AND public.prospect_owner_current(c.account_id, c.owner_id, c.owner_assigned_at, c.owner_last_activity_at) THEN
    RETURN 'yours';
  END IF;
  RETURN 'taken';
END;
$$;
ALTER FUNCTION public.phone_registration_status(TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.phone_registration_status(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 6 · Existing data
-- ------------------------------------------------------------
-- Every existing contact starts without an owner ("Sin asesor").
-- Admins keep seeing everything; advisors start with an empty list
-- until prospects are assigned to them.
