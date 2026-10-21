-- These SECURITY DEFINER functions are trigger entry points, not client RPCs.
-- Trigger invocation continues to work; only direct API execution is removed.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_daily_focus() from public, anon, authenticated;
