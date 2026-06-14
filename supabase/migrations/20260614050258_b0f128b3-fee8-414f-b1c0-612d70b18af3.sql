REVOKE EXECUTE ON FUNCTION public.pl_block_logger_enabled() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pl_row_has_unsupported_blocks(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pl_clone_blocks_for_rows(jsonb) FROM PUBLIC;