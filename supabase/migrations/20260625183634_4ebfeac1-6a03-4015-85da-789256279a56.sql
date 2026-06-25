CREATE OR REPLACE FUNCTION public._tmp_install_fullbody_sql(p_sql text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
BEGIN
  EXECUTE p_sql;
END
$func$;
GRANT EXECUTE ON FUNCTION public._tmp_install_fullbody_sql(text) TO sandbox_exec;