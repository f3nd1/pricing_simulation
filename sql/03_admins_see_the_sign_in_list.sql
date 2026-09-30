-- ═══════════════════════════════════════════════════════════════════════
-- allowed_users — let a DELEGATED admin read the sign-in list.
--
-- THE PROBLEM. INSERT and DELETE on this table are gated on is_any_admin(),
-- so a granted admin (currently renzo@) can add and remove people. But the
-- SELECT policy is gated on is_admin() — the hardcoded root only — so that
-- same person cannot SEE the list they are administering. They must type an
-- address blind to remove someone. This is incoherent, and it affects
-- gd4_simulator too, which shares this table; fixing it here fixes it there.
--
-- WHAT CHANGES. One clause: is_admin() becomes is_any_admin(). Nothing else.
--
-- WHAT MUST NOT CHANGE, AND WHY THIS FILE WOULD BE CATASTROPHIC WITHOUT IT:
-- the "your own row" clause stays. public.is_allowed_user() is invoker-rights
-- and does `exists (select 1 from allowed_users where email_lc = <caller>)`.
-- That subquery only returns a row because this policy lets the caller see
-- their own. Drop that clause and is_allowed_user() returns false for every
-- non-admin — locking them out of the Planning Suite's entry gate and cloud
-- save AND gd4's locked_stores and workspace_state, while the two admins
-- carry on working and see nothing wrong.
--
-- NO RECURSION: this policy asks is_any_admin(), which reads admin_grants,
-- whose own policies ask only is_admin(), which reads no table.
--
-- SCOPE: the SELECT policies on public.allowed_users, and nothing else. The
-- INSERT and DELETE policies belong to the shared admin model and are not
-- named, counted or touched here. This file does not create, replace, alter
-- or drop any function.
-- ═══════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  p record;
  n int;
begin
  -- Refuse if the function this policy will depend on is absent, rather than
  -- installing a policy that throws at query time and denies everybody.
  if to_regprocedure('public.is_any_admin()') is null then
    raise exception
      'Refusing to run: public.is_any_admin() does not exist in this project. Nothing has been changed.';
  end if;

  -- Refuse if there is no SELECT policy to replace. Finding none means this
  -- table is not shaped the way this file expects, and creating one blind
  -- could widen or narrow access in ways nobody reviewed.
  select count(*) into n from pg_policies
  where schemaname='public' and tablename='allowed_users' and cmd='SELECT';
  if n = 0 then
    raise exception
      'Refusing to run: allowed_users has no SELECT policy to replace. Nothing has been changed.';
  end if;

  -- Replace every SELECT policy, whatever it is called. INSERT and DELETE
  -- are left exactly as they are.
  for p in
    select policyname from pg_policies
    where schemaname='public' and tablename='allowed_users' and cmd='SELECT'
  loop
    execute format('drop policy %I on public.allowed_users', p.policyname);
    raise notice 'dropped SELECT policy "%" on allowed_users', p.policyname;
  end loop;
end $$;

create policy "see your own row, or all of them if admin" on public.allowed_users
  for select to authenticated
  using (
    email_lc = lower(auth.jwt() ->> 'email')   -- keep: is_allowed_user() needs this
    or public.is_any_admin()                   -- changed from is_admin()
  );

commit;

-- VERIFY, and do this one before trusting anything:
--   select public.is_allowed_user();
-- Run it as a NON-admin (or ask one of the eight to load either app). It must
-- still return true. If it returns false, roll back immediately:
--   drop policy "see your own row, or all of them if admin" on public.allowed_users;
--   create policy "see your own row, or all of them if admin" on public.allowed_users
--     for select to authenticated
--     using (email_lc = lower(auth.jwt() ->> 'email') or public.is_admin());
