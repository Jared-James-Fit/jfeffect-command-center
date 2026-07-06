-- Backfill exercise_name_override in pl_templates payload rows
-- 
-- Root cause: Some program templates have rows with exercise_id values but
-- no exercise_name_override. The program builder shows "Unnamed exercise"
-- when it can't find the exercise in the exercises table (e.g. if the exercise
-- was renamed or the ID changed).
--
-- This migration:
-- 1. For schema_version=2 (blocks format): updates each row's exercise_name_override
--    from the exercises table where exercise_id matches and exercise_name_override is null/empty
-- 2. For legacy format (weeks_data): same treatment
-- 3. For rows where exercise_id doesn't exist in exercises table: leaves them as-is
--    (they'll still show "Unnamed exercise" but that's a data integrity issue)

DO $$
DECLARE
  tmpl RECORD;
  new_payload jsonb;
BEGIN
  -- Process each template
  FOR tmpl IN SELECT id, payload FROM pl_templates WHERE payload IS NOT NULL LOOP
    new_payload := tmpl.payload;
    
    -- Handle schema_version=2 (blocks format)
    IF (new_payload->>'schema_version')::int = 2 AND jsonb_typeof(new_payload->'blocks') = 'array' THEN
      -- Update blocks -> weeks -> days -> rows
      SELECT jsonb_set(
        new_payload,
        '{blocks}',
        (
          SELECT jsonb_agg(
            jsonb_set(
              blk,
              '{weeks}',
              (
                SELECT jsonb_agg(
                  jsonb_set(
                    wk,
                    '{days}',
                    (
                      SELECT jsonb_agg(
                        jsonb_set(
                          dy,
                          '{rows}',
                          (
                            SELECT jsonb_agg(
                              CASE
                                WHEN (row_item->>'exercise_id') IS NOT NULL
                                  AND (row_item->>'exercise_name_override' IS NULL OR row_item->>'exercise_name_override' = '')
                                THEN
                                  jsonb_set(
                                    row_item,
                                    '{exercise_name_override}',
                                    to_jsonb(COALESCE(
                                      (SELECT name FROM exercises WHERE id = (row_item->>'exercise_id')::uuid),
                                      row_item->>'exercise_name_override'
                                    ))
                                  )
                                ELSE row_item
                              END
                            )
                            FROM jsonb_array_elements(dy->'rows') AS row_item
                          )
                        )
                      )
                      FROM jsonb_array_elements(wk->'days') AS dy
                    )
                  )
                )
                FROM jsonb_array_elements(blk->'weeks') AS wk
              )
            )
          )
          FROM jsonb_array_elements(new_payload->'blocks') AS blk
        )
      ) INTO new_payload;
    
    -- Handle legacy format (weeks_data)
    ELSIF jsonb_typeof(new_payload->'weeks_data') = 'array' THEN
      SELECT jsonb_set(
        new_payload,
        '{weeks_data}',
        (
          SELECT jsonb_agg(
            jsonb_set(
              wk,
              '{days}',
              (
                SELECT jsonb_agg(
                  jsonb_set(
                    dy,
                    '{rows}',
                    (
                      SELECT jsonb_agg(
                        CASE
                          WHEN (row_item->>'exercise_id') IS NOT NULL
                            AND (row_item->>'exercise_name_override' IS NULL OR row_item->>'exercise_name_override' = '')
                          THEN
                            jsonb_set(
                              row_item,
                              '{exercise_name_override}',
                              to_jsonb(COALESCE(
                                (SELECT name FROM exercises WHERE id = (row_item->>'exercise_id')::uuid),
                                row_item->>'exercise_name_override'
                              ))
                            )
                          ELSE row_item
                        END
                      )
                      FROM jsonb_array_elements(dy->'rows') AS row_item
                    )
                  )
                )
                FROM jsonb_array_elements(wk->'days') AS dy
              )
            )
          )
          FROM jsonb_array_elements(new_payload->'weeks_data') AS wk
        )
      ) INTO new_payload;
    END IF;
    
    -- Update the template if payload changed
    IF new_payload IS DISTINCT FROM tmpl.payload THEN
      UPDATE pl_templates SET payload = new_payload WHERE id = tmpl.id;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Backfill complete: exercise_name_override populated from exercises table';
END $$;
