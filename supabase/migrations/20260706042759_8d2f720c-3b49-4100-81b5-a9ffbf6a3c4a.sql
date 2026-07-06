DO $$
DECLARE
  tmpl RECORD;
  new_payload jsonb;
BEGIN
  FOR tmpl IN SELECT id, payload FROM pl_templates WHERE payload IS NOT NULL LOOP
    new_payload := tmpl.payload;

    -- schema_version=2 with blocks_data (block -> weeks_data -> days -> rows)
    IF jsonb_typeof(new_payload->'blocks_data') = 'array' THEN
      SELECT jsonb_set(
        new_payload,
        '{blocks_data}',
        (
          SELECT jsonb_agg(
            jsonb_set(
              blk,
              '{weeks_data}',
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_set(
                    wk,
                    '{days}',
                    COALESCE((
                      SELECT jsonb_agg(
                        jsonb_set(
                          dy,
                          '{rows}',
                          COALESCE((
                            SELECT jsonb_agg(
                              CASE
                                WHEN (row_item->>'exercise_id') IS NOT NULL
                                  AND (row_item->>'exercise_name_override' IS NULL OR row_item->>'exercise_name_override' = '')
                                  AND (SELECT name FROM exercises WHERE id = (row_item->>'exercise_id')::uuid) IS NOT NULL
                                THEN
                                  jsonb_set(
                                    row_item,
                                    '{exercise_name_override}',
                                    to_jsonb((SELECT name FROM exercises WHERE id = (row_item->>'exercise_id')::uuid))
                                  )
                                ELSE row_item
                              END
                            )
                            FROM jsonb_array_elements(dy->'rows') AS row_item
                          ), '[]'::jsonb)
                        )
                      )
                      FROM jsonb_array_elements(wk->'days') AS dy
                    ), '[]'::jsonb)
                  )
                )
                FROM jsonb_array_elements(blk->'weeks_data') AS wk
              ), '[]'::jsonb)
            )
          )
          FROM jsonb_array_elements(new_payload->'blocks_data') AS blk
        )
      ) INTO new_payload;

    -- legacy: top-level weeks_data
    ELSIF jsonb_typeof(new_payload->'weeks_data') = 'array' THEN
      SELECT jsonb_set(
        new_payload,
        '{weeks_data}',
        (
          SELECT jsonb_agg(
            jsonb_set(
              wk,
              '{days}',
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_set(
                    dy,
                    '{rows}',
                    COALESCE((
                      SELECT jsonb_agg(
                        CASE
                          WHEN (row_item->>'exercise_id') IS NOT NULL
                            AND (row_item->>'exercise_name_override' IS NULL OR row_item->>'exercise_name_override' = '')
                            AND (SELECT name FROM exercises WHERE id = (row_item->>'exercise_id')::uuid) IS NOT NULL
                          THEN
                            jsonb_set(
                              row_item,
                              '{exercise_name_override}',
                              to_jsonb((SELECT name FROM exercises WHERE id = (row_item->>'exercise_id')::uuid))
                            )
                          ELSE row_item
                        END
                      )
                      FROM jsonb_array_elements(dy->'rows') AS row_item
                    ), '[]'::jsonb)
                  )
                )
                FROM jsonb_array_elements(wk->'days') AS dy
              ), '[]'::jsonb)
            )
          )
          FROM jsonb_array_elements(new_payload->'weeks_data') AS wk
        )
      ) INTO new_payload;
    END IF;

    IF new_payload IS DISTINCT FROM tmpl.payload THEN
      UPDATE pl_templates SET payload = new_payload WHERE id = tmpl.id;
    END IF;
  END LOOP;
END $$;