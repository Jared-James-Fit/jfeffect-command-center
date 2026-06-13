-- Migration C: Persisted template operations log

CREATE TABLE IF NOT EXISTS public.pl_template_operations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES public.pl_templates(id) ON DELETE CASCADE,
  actor_user_id uuid,
  operation_type text NOT NULL,
  affected_block_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  before_payload jsonb,
  after_payload jsonb,
  base_revision bigint NOT NULL,
  result_revision bigint NOT NULL,
  status text NOT NULL DEFAULT 'active',
  idempotency_key text,
  undone_at timestamptz,
  redone_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pl_template_operations_type_chk CHECK (
    operation_type IN (
      'add_block','duplicate_block','rename_block','set_phase','set_notes',
      'set_estimated_duration','reorder_blocks','archive_block','restore_block',
      'trash_block','restore_from_trash','purge_block','set_week_count'
    )
  ),
  CONSTRAINT pl_template_operations_status_chk CHECK (
    status IN ('active','undone','redone','superseded')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS pl_template_operations_idem_uniq
  ON public.pl_template_operations (template_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS pl_template_operations_template_created_idx
  ON public.pl_template_operations (template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pl_template_operations_template_status_idx
  ON public.pl_template_operations (template_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.pl_template_operations TO authenticated;
GRANT ALL ON public.pl_template_operations TO service_role;

ALTER TABLE public.pl_template_operations ENABLE ROW LEVEL SECURITY;

-- Only admins can manage template operations (templates are admin-edited today).
CREATE POLICY "Admin manage pl_template_operations"
  ON public.pl_template_operations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Append-only guard: only status / undone_at / redone_at / superseded_at / updated_at may change.
CREATE OR REPLACE FUNCTION public.tg_pl_template_operations_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
     OR NEW.affected_block_keys IS DISTINCT FROM OLD.affected_block_keys
     OR NEW.before_payload IS DISTINCT FROM OLD.before_payload
     OR NEW.after_payload IS DISTINCT FROM OLD.after_payload
     OR NEW.base_revision IS DISTINCT FROM OLD.base_revision
     OR NEW.result_revision IS DISTINCT FROM OLD.result_revision
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'pl_template_operations is append-only except for status timestamps'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_pl_template_operations_append_only ON public.pl_template_operations;
CREATE TRIGGER tg_pl_template_operations_append_only
  BEFORE UPDATE ON public.pl_template_operations
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_template_operations_append_only();

-- Revision-safe payload write with operation logging.
-- Performs compare-and-swap on pl_templates.payload_revision and atomically records the operation.
CREATE OR REPLACE FUNCTION public.pl_template_apply_payload(
  _template_id uuid,
  _expected_revision bigint,
  _new_payload jsonb,
  _operation_type text,
  _affected_block_keys text[],
  _before_payload jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS TABLE(new_revision bigint, operation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_revision bigint;
  v_op_id uuid;
  v_existing_op_id uuid;
  v_existing_revision bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized to modify template'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotency short-circuit.
  IF _idempotency_key IS NOT NULL THEN
    SELECT id, result_revision INTO v_existing_op_id, v_existing_revision
      FROM public.pl_template_operations
     WHERE template_id = _template_id AND idempotency_key = _idempotency_key
     LIMIT 1;
    IF v_existing_op_id IS NOT NULL THEN
      RETURN QUERY SELECT v_existing_revision, v_existing_op_id;
      RETURN;
    END IF;
  END IF;

  -- Compare-and-swap on payload_revision; trigger increments to expected+1.
  UPDATE public.pl_templates
     SET payload = _new_payload
   WHERE id = _template_id
     AND payload_revision = _expected_revision
  RETURNING payload_revision INTO v_new_revision;

  IF v_new_revision IS NULL THEN
    RAISE EXCEPTION 'revision_conflict'
      USING ERRCODE = 'serialization_failure',
            HINT = 'Template payload changed since last load. Reload and retry.';
  END IF;

  INSERT INTO public.pl_template_operations (
    template_id, actor_user_id, operation_type, affected_block_keys,
    before_payload, after_payload, base_revision, result_revision,
    idempotency_key, status
  ) VALUES (
    _template_id, auth.uid(), _operation_type, COALESCE(_affected_block_keys, ARRAY[]::text[]),
    _before_payload, _new_payload, _expected_revision, v_new_revision,
    _idempotency_key, 'active'
  ) RETURNING id INTO v_op_id;

  RETURN QUERY SELECT v_new_revision, v_op_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pl_template_apply_payload(uuid, bigint, jsonb, text, text[], jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_template_apply_payload(uuid, bigint, jsonb, text, text[], jsonb, text) TO authenticated, service_role;

-- Undo: reverts to the operation's before_payload, requires current revision = op's result_revision.
CREATE OR REPLACE FUNCTION public.pl_template_undo_operation(_operation_id uuid)
RETURNS TABLE(new_revision bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.pl_template_operations;
  v_current_revision bigint;
  v_new_revision bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_op FROM public.pl_template_operations WHERE id = _operation_id;
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'operation_not_found';
  END IF;
  IF v_op.status NOT IN ('active','redone') THEN
    RAISE EXCEPTION 'operation_not_undoable' USING HINT = 'Status is ' || v_op.status;
  END IF;
  IF v_op.before_payload IS NULL THEN
    RAISE EXCEPTION 'operation_missing_before_payload';
  END IF;

  UPDATE public.pl_templates
     SET payload = v_op.before_payload
   WHERE id = v_op.template_id
     AND payload_revision = v_op.result_revision
  RETURNING payload_revision INTO v_new_revision;

  IF v_new_revision IS NULL THEN
    RAISE EXCEPTION 'revision_conflict' USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE public.pl_template_operations
     SET status = 'undone', undone_at = now()
   WHERE id = _operation_id;

  RETURN QUERY SELECT v_new_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.pl_template_undo_operation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_template_undo_operation(uuid) TO authenticated, service_role;

-- Redo: reapplies the operation's after_payload, requires current revision = op's base_revision.
CREATE OR REPLACE FUNCTION public.pl_template_redo_operation(_operation_id uuid)
RETURNS TABLE(new_revision bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.pl_template_operations;
  v_new_revision bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_op FROM public.pl_template_operations WHERE id = _operation_id;
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'operation_not_found';
  END IF;
  IF v_op.status <> 'undone' THEN
    RAISE EXCEPTION 'operation_not_redoable' USING HINT = 'Status is ' || v_op.status;
  END IF;
  IF v_op.after_payload IS NULL THEN
    RAISE EXCEPTION 'operation_missing_after_payload';
  END IF;

  UPDATE public.pl_templates
     SET payload = v_op.after_payload
   WHERE id = v_op.template_id
     AND payload_revision = v_op.base_revision
  RETURNING payload_revision INTO v_new_revision;

  IF v_new_revision IS NULL THEN
    RAISE EXCEPTION 'revision_conflict' USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE public.pl_template_operations
     SET status = 'redone', redone_at = now()
   WHERE id = _operation_id;

  RETURN QUERY SELECT v_new_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.pl_template_redo_operation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_template_redo_operation(uuid) TO authenticated, service_role;
