-- ═══════════════════════════════════════════════════════════════════════
-- ucc_saves — STEP 2 of 2.  THIS IS THE CUTOVER.
--
-- RUN ONLY AFTER:
--   1. 01_add_signin_policies.sql has run, AND
--   2. the new code is deployed, AND
--   3. a real person who is on allowed_users has signed in and confirmed a
--      save, a load and a delete all work in a browser.
--
-- Until step 3 is done the sign-in path is unproven, and running this file
-- turns an unproven path into the only path.
--
-- One transaction, so the swap is atomic: there is no instant at which both
-- policy sets are live, and none at which neither is.
--
-- WHY THIS SWEEPS INSTEAD OF NAMING WHAT TO DROP: dropping by name only
-- removes the names you thought of. `drop policy if exists "public read"`
-- silently does nothing if the live policy is called something else — and a
-- policy added by hand in the dashboard, or pasted from an old setup
-- snippet, will not be called what this file expects. So this drops
-- everything on ucc_saves that is NOT on the expected list, and refuses to
-- run at all if the policies that must survive are absent.
--
-- SHARED PROJECT: public.is_allowed_user() is used by other applications.
-- This file does not create, replace, alter or drop it.
--
-- Scope: public.ucc_saves only. No other table is touched.
--
-- ROLLBACK: re-run the four `create policy` statements from the original
-- supabase_setup.sql. Keep that file.
-- ═══════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  keep text[] := array[
    'ucc saves read (signed in)',
    'ucc saves insert (signed in)',
    'ucc saves update (signed in)',
    'ucc saves delete (signed in)'
  ];
  p record;
  missing text;
begin
  -- FIRST, refuse to run if the policies that are supposed to survive are
  -- not there. Sweeping this table down to zero policies denies everybody.
  -- Nothing is dropped before this check passes.
  select string_agg(want, ', ') into missing
  from unnest(keep) as want
  where not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'ucc_saves'
      and policyname = want
  );

  if missing is not null then
    raise exception
      'Refusing to run: ucc_saves is missing the policies that must survive (%). Run 01_add_signin_policies.sql first, then run this again. Nothing has been changed.',
      missing;
  end if;

  -- Now drop everything else, whatever it is called.
  for p in
    select policyname from pg_policies
    where schemaname = 'public'
      and tablename  = 'ucc_saves'
      and policyname <> all(keep)
  loop
    execute format('drop policy %I on public.ucc_saves', p.policyname);
    raise notice 'dropped policy "%" on ucc_saves', p.policyname;
  end loop;
end $$;

commit;

-- VERIFY, in the SQL editor or Authentication > Policies:
--   select policyname, cmd, roles from pg_policies
--   where schemaname='public' and tablename='ucc_saves';
-- Expect exactly the four "(signed in)" policies, all with roles {authenticated}.
