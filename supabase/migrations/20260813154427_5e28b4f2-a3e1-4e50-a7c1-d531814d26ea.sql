-- 1. Legal acceptances / consent preferences: client_id must belong to the caller
DROP POLICY IF EXISTS "Users insert their own acceptances" ON public.legal_acceptances;
CREATE POLICY "Users insert their own acceptances"
ON public.legal_acceptances FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    client_id IS NULL
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users manage their own consent preferences" ON public.legal_consent_preferences;
CREATE POLICY "Users manage their own consent preferences"
ON public.legal_consent_preferences FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND (
    client_id IS NULL
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
  )
);

-- 2. na_signatures: package_id/snapshot_id must match the signer's own row
DROP POLICY IF EXISTS "nasig insert via service or signer" ON public.na_signatures;
CREATE POLICY "nasig insert via service or signer"
ON public.na_signatures FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    EXISTS (
      SELECT 1 FROM public.na_signers s
      WHERE s.id = signer_id
        AND s.user_id = auth.uid()
        AND s.package_id = na_signatures.package_id
    )
    AND (
      snapshot_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.na_snapshots sn
        WHERE sn.id = snapshot_id AND sn.package_id = na_signatures.package_id
      )
    )
  )
);

-- 3. pl_schedule_audit: caller must own or coach the referenced client
DROP POLICY IF EXISTS "users insert own schedule audit" ON public.pl_schedule_audit;
CREATE POLICY "users insert own schedule audit"
ON public.pl_schedule_audit FOR INSERT TO authenticated
WITH CHECK (
  changed_by = auth.uid()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
    OR (client_id IS NOT NULL AND is_assigned_coach(client_id))
  )
);

-- 4. Revoke anon EXECUTE on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.session_balance(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_pt_session_release_on_delete() FROM anon, authenticated, PUBLIC;
