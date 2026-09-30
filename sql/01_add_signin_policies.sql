-- ═══════════════════════════════════════════════════════════════════════
-- ucc_saves — STEP 1 of 2.  RUN THIS BEFORE THE CODE DEPLOYS.
--
-- Purely ADDITIVE. It adds sign-in policies alongside the existing open
-- ones and removes nothing. RLS policies are permissive and combine with
-- OR, so once this has run BOTH the old anonymous access and the new
-- signed-in access work.
--
--   * Nothing breaks.
--   * Nobody is locked out.
--   * Exposure is exactly what it was before this ran — this file does not
--     close the hole. 02_revoke_anon_access.sql does, after the code is
--     live and verified.
--
-- ORDER, and why this one is first: new SQL that needs new code goes
-- AFTER the deploy; new code that needs new SQL goes BEFORE it. The new
-- code sends a signed-in user's token and needs a policy that accepts it,
-- so the policy has to exist first. Old code keeps working throughout
-- because the open policies are still here.
--
-- SHARED PROJECT — READ THIS. public.is_allowed_user() is used by other
-- applications in this Supabase project. This file CALLS it and must never
-- create, replace, alter or drop it. Rewriting that function would silently
-- change who can reach those other applications' data, with no error.
--
-- Scope: public.ucc_saves only. No other table is touched.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- Idempotent safety net. If RLS were ever switched off on this table every
-- policy below would be ignored and the table would answer anyone,
-- regardless of what is written here.
alter table public.ucc_saves enable row level security;

-- Refuse to run if the shared function is missing, rather than creating
-- policies that would throw at query time and lock everyone out.
do $$
begin
  if to_regprocedure('public.is_allowed_user()') is null then
    raise exception
      'Refusing to run: public.is_allowed_user() does not exist in this project. Nothing has been changed.';
  end if;
end $$;

create policy "ucc saves read (signed in)" on public.ucc_saves
  for select to authenticated
  using (public.is_allowed_user());

create policy "ucc saves insert (signed in)" on public.ucc_saves
  for insert to authenticated
  with check (public.is_allowed_user());

-- UPDATE needs both: USING picks which rows may be changed, WITH CHECK
-- validates the row after the change. Without WITH CHECK an allowed user
-- could write a row that no longer satisfies the policy.
create policy "ucc saves update (signed in)" on public.ucc_saves
  for update to authenticated
  using (public.is_allowed_user())
  with check (public.is_allowed_user());

create policy "ucc saves delete (signed in)" on public.ucc_saves
  for delete to authenticated
  using (public.is_allowed_user());

commit;

-- AFTER THIS RUNS: deploy the code, then sign in as a real user who is on
-- allowed_users and confirm a save, a load and a delete all work. Only then
-- run 02_revoke_anon_access.sql.
