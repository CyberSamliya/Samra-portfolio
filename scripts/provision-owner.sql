-- Run privately as the database administrator, after creating ONE confirmed Auth user
-- with Supabase Dashboard > Authentication > Add user. Public signup MUST be disabled.
-- psql "$DATABASE_URL" -v owner_id="<verified Auth user UUID>" -f scripts/provision-owner.sql
-- Never commit a populated copy. A second/different owner requires a deliberate DB change.
\set ON_ERROR_STOP on
begin;
insert into jobs_private.owner(singleton,user_id) values(true, :'owner_id'::uuid);
commit;
