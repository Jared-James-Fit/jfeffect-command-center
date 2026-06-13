
-- 1. Soft-archive column for questions
ALTER TABLE public.nf_questions
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS nf_questions_form_active_idx
  ON public.nf_questions(form_id, order_index) WHERE archived_at IS NULL;

-- 2. Form versions table
CREATE TABLE IF NOT EXISTS public.nf_form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.nf_forms(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  form_snapshot jsonb NOT NULL,
  questions_snapshot jsonb NOT NULL,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (form_id, version_number)
);
CREATE INDEX IF NOT EXISTS nf_form_versions_form_idx
  ON public.nf_form_versions(form_id, version_number DESC);

GRANT SELECT ON public.nf_form_versions TO authenticated;
GRANT ALL ON public.nf_form_versions TO service_role;
ALTER TABLE public.nf_form_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read nf_form_versions" ON public.nf_form_versions;
CREATE POLICY "Staff read nf_form_versions" ON public.nf_form_versions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.coaches co WHERE co.user_id = auth.uid() AND co.archived = false)
  );

DROP POLICY IF EXISTS "Admin manage nf_form_versions" ON public.nf_form_versions;
CREATE POLICY "Admin manage nf_form_versions" ON public.nf_form_versions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Track which form version a submission was filled against
ALTER TABLE public.nf_submissions
  ADD COLUMN IF NOT EXISTS form_version_id uuid REFERENCES public.nf_form_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS form_version_number integer;

-- 4. RPC: publish a new form version (admin only)
CREATE OR REPLACE FUNCTION public.nf_publish_form_version(_form_id uuid, _reason text DEFAULT NULL)
RETURNS public.nf_form_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_form jsonb;
  v_questions jsonb;
  v_next int;
  v_row public.nf_form_versions;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can publish form versions' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(f.*) INTO v_form FROM public.nf_forms f WHERE id = _form_id;
  IF v_form IS NULL THEN
    RAISE EXCEPTION 'Form not found';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(q.*) ORDER BY q.order_index), '[]'::jsonb)
    INTO v_questions
    FROM public.nf_questions q
   WHERE q.form_id = _form_id AND q.archived_at IS NULL;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
    FROM public.nf_form_versions WHERE form_id = _form_id;

  INSERT INTO public.nf_form_versions
    (form_id, version_number, form_snapshot, questions_snapshot, change_reason, created_by)
  VALUES (_form_id, v_next, v_form, v_questions, NULLIF(btrim(COALESCE(_reason,'')), ''), auth.uid())
  RETURNING * INTO v_row;

  UPDATE public.nf_forms SET version = v_next, updated_at = now() WHERE id = _form_id;
  RETURN v_row;
END;
$$;

-- 5. RPC: restore from a version (creates a new version as well)
CREATE OR REPLACE FUNCTION public.nf_restore_form_version(_version_id uuid, _reason text DEFAULT NULL)
RETURNS public.nf_form_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_src public.nf_form_versions;
  v_q jsonb;
  v_qid uuid;
  v_keep uuid[];
  v_new public.nf_form_versions;
  v_reason text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can restore form versions' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_src FROM public.nf_form_versions WHERE id = _version_id;
  IF v_src IS NULL THEN RAISE EXCEPTION 'Version not found'; END IF;

  -- Apply form-level snapshot fields (excluding identity/timestamps).
  UPDATE public.nf_forms SET
    title = COALESCE(v_src.form_snapshot->>'title', title),
    description = v_src.form_snapshot->>'description',
    form_type = COALESCE(v_src.form_snapshot->>'form_type', form_type),
    recurrence = COALESCE(v_src.form_snapshot->>'recurrence', recurrence),
    recurrence_day = v_src.form_snapshot->>'recurrence_day',
    kind = COALESCE(v_src.form_snapshot->>'kind', kind),
    external_url = v_src.form_snapshot->>'external_url',
    button_label = v_src.form_snapshot->>'button_label',
    open_style = COALESCE(v_src.form_snapshot->>'open_style', open_style),
    visibility = COALESCE(v_src.form_snapshot->>'visibility', visibility),
    requires_client_identity = COALESCE((v_src.form_snapshot->>'requires_client_identity')::boolean, requires_client_identity),
    updated_at = now()
  WHERE id = v_src.form_id;

  -- Upsert each snapshot question, preserving ids.
  v_keep := ARRAY[]::uuid[];
  FOR v_q IN SELECT * FROM jsonb_array_elements(v_src.questions_snapshot)
  LOOP
    v_qid := NULLIF(v_q->>'id','')::uuid;
    IF v_qid IS NULL THEN v_qid := gen_random_uuid(); END IF;
    v_keep := array_append(v_keep, v_qid);

    INSERT INTO public.nf_questions
      (id, form_id, order_index, question_type, label, help_text, required, options, validation, conditional_logic, archived_at)
    VALUES (
      v_qid, v_src.form_id,
      COALESCE((v_q->>'order_index')::int, 0),
      v_q->>'question_type',
      COALESCE(v_q->>'label', 'Question'),
      v_q->>'help_text',
      COALESCE((v_q->>'required')::boolean, false),
      COALESCE(v_q->'options', '[]'::jsonb),
      COALESCE(v_q->'validation', '{}'::jsonb),
      COALESCE(v_q->'conditional_logic', '{}'::jsonb),
      NULL
    )
    ON CONFLICT (id) DO UPDATE SET
      order_index = EXCLUDED.order_index,
      question_type = EXCLUDED.question_type,
      label = EXCLUDED.label,
      help_text = EXCLUDED.help_text,
      required = EXCLUDED.required,
      options = EXCLUDED.options,
      validation = EXCLUDED.validation,
      conditional_logic = EXCLUDED.conditional_logic,
      archived_at = NULL,
      updated_at = now();
  END LOOP;

  -- Soft-archive current questions not in snapshot.
  UPDATE public.nf_questions
     SET archived_at = now(), updated_at = now()
   WHERE form_id = v_src.form_id
     AND archived_at IS NULL
     AND id <> ALL(v_keep);

  v_reason := 'Restored from v' || v_src.version_number::text
    || CASE WHEN _reason IS NOT NULL AND length(btrim(_reason)) > 0
            THEN ' — ' || btrim(_reason) ELSE '' END;

  SELECT * INTO v_new FROM public.nf_publish_form_version(v_src.form_id, v_reason);
  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.nf_publish_form_version(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_restore_form_version(uuid, text) TO authenticated;
