begin;
create schema if not exists jobs_private;
revoke all on schema jobs_private from public, anon, authenticated;
create table jobs_private.owner (singleton boolean primary key default true check(singleton), user_id uuid not null unique references auth.users(id));
revoke all on jobs_private.owner from public, anon, authenticated;
create function jobs_private.authorized() returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select auth.jwt()->>'aal') = 'aal2' and exists(select 1 from jobs_private.owner where user_id=(select auth.uid())),false)
$$;
-- Only the predicate is callable. Owner registration remains inaccessible through the API.
grant usage on schema jobs_private to authenticated;
grant execute on function jobs_private.authorized() to authenticated;
revoke execute on function jobs_private.authorized() from public, anon;
create function public.jobs_authorized() returns boolean language sql stable security invoker set search_path = '' as $$select jobs_private.authorized()$$;
revoke all on function public.jobs_authorized() from public, anon;
grant execute on function public.jobs_authorized() to authenticated;

create table public.jobs_profiles (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 150),
 track text not null, content text not null default '' check(length(content)<=100000), created_at timestamptz not null default now()
);
insert into public.jobs_profiles(name,track) values('Cybersecurity','Cybersecurity'),('Operational Excellence','Operational Excellence');
create table public.jobs_applications (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 250), company text not null check(length(company) between 1 and 250),
 requisition_id text not null default '', posting_url text not null check(posting_url ~ '^https://[^[:space:]]+$'), normalized_url text not null,
 source text not null default 'Manual', source_id text, career_track text not null default 'Cybersecurity', location text not null default '',
 arrangement text not null default 'Unknown' check(arrangement in ('On-site','Hybrid','Remote','Unknown')), pay_range text not null default '',
 date_found date not null default current_date, deadline date, date_applied date, next_follow_up date, notes text not null default '',
 description text not null default '', fit jsonb not null default '{}', profile_id uuid references public.jobs_profiles(id),
 status text not null default 'Saved' check(status in ('Saved','Preparing','Applied','Screening','Interview','Offer','Rejected','Withdrawn','Archived')),
 submitted_document_ids uuid[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(normalized_url), check(length(description)<=100000 and length(notes)<=50000)
);
create unique index jobs_source_dedup on public.jobs_applications(lower(source),source_id) where source_id is not null and source_id<>'';
create table public.jobs_documents (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.jobs_applications(id),
 kind text not null check(kind in ('Resume','Cover letter')), version text not null check(length(version) between 1 and 150),
 state text not null default 'Draft' check(state in ('Draft','Submitted')), draft_text text not null default '',
 object_path text unique, filename text, mime_type text check(mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 uploaded boolean not null default false, created_at timestamptz not null default now(),
 check(object_path is null or object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'), check(length(draft_text)<=100000)
);
create table public.jobs_history (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.jobs_applications(id),
 occurred_at timestamptz not null default now(), actor uuid not null, before_record jsonb, after_record jsonb not null
);
create table public.jobs_settings (key text primary key, value jsonb not null);
create table public.jobs_alert_messages (
 id uuid primary key default gen_random_uuid(), source text not null, external_id text not null, received_at timestamptz not null,
 format text not null, lead_count integer not null default 0, created_at timestamptz not null default now(), unique(source,external_id)
);
create table public.jobs_leads (
 id uuid primary key default gen_random_uuid(), message_id uuid not null references public.jobs_alert_messages(id),
 title text not null, company text not null default '', posting_url text not null, source text not null,
 received_at timestamptz not null, warning text not null default '', state text not null default 'Review' check(state in ('Review','Saved','Dismissed')),
 application_id uuid references public.jobs_applications(id), unique(message_id,posting_url)
);
create table public.jobs_import_state (
 id boolean primary key default true check(id), connected boolean not null default false,
 last_success timestamptz, imported integer not null default 0, leads integer not null default 0,
 error text, cursor text, updated_at timestamptz not null default now()
);
insert into public.jobs_import_state(id) values(true);

-- Every private table requires the server-held owner ID and a signed AAL2 JWT.
do $$ declare t text; begin
 foreach t in array array['jobs_profiles','jobs_applications','jobs_documents','jobs_history','jobs_settings','jobs_alert_messages','jobs_leads','jobs_import_state'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 execute format('grant select, insert, update on public.%I to authenticated',t);
 execute format('create policy owner_mfa on public.%I for all to authenticated using ((select jobs_private.authorized())) with check ((select jobs_private.authorized()))',t);
 end loop;
end $$;
-- Append-only audit, generated by a trigger; no direct writes by the browser.
revoke insert,update on public.jobs_history from authenticated;
create function jobs_private.audit_application() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.jobs_history(application_id,actor,before_record,after_record) values(new.id,auth.uid(),case when TG_OP='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
create trigger jobs_audit after insert or update on public.jobs_applications for each row execute function jobs_private.audit_application();
create function jobs_private.touch_application() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at=now();
 if new.status='Applied' and new.date_applied is null then raise exception 'Date applied is required'; end if;
 return new;
end $$;
create trigger jobs_touch before insert or update on public.jobs_applications for each row execute function jobs_private.touch_application();
create function jobs_private.protect_document() returns trigger language plpgsql set search_path='' as $$
begin
 if old.state='Submitted' then raise exception 'Submitted versions are immutable; create a new version'; end if;
 if old.uploaded and (new.object_path is distinct from old.object_path or new.filename is distinct from old.filename or new.mime_type is distinct from old.mime_type or new.application_id is distinct from old.application_id or not new.uploaded) then raise exception 'File versions are immutable'; end if;
 if new.state='Submitted' and not new.uploaded then raise exception 'Upload a finished document first'; end if;
 return new;
end $$;
create trigger jobs_document_immutable before update on public.jobs_documents for each row execute function jobs_private.protect_document();
create function public.jobs_mark_applied(application uuid, documents uuid[], applied_on date) returns void language plpgsql security invoker set search_path='' as $$
declare d uuid; begin
 if not jobs_private.authorized() then raise exception 'Owner and MFA required' using errcode='42501'; end if;
 if applied_on is null then raise exception 'Date required'; end if;
 perform 1 from public.jobs_applications where id=application for update;
 if not found then raise exception 'Application not found'; end if;
 foreach d in array documents loop
  if not exists(select 1 from public.jobs_documents where id=d and application_id=application and uploaded) then raise exception 'Invalid document version'; end if;
  update public.jobs_documents set state='Submitted' where id=d and state='Draft';
 end loop;
 update public.jobs_applications set status='Applied',date_applied=applied_on,submitted_document_ids=documents where id=application;
end $$;
revoke all on function public.jobs_mark_applied(uuid,uuid[],date) from public,anon;
grant execute on function public.jobs_mark_applied(uuid,uuid[],date) to authenticated;

-- Atomic, retry-safe ingestion; never store raw email bodies or attachments.
create function public.jobs_ingest_alert(source_name text, message_key text, received timestamptz, format_name text, leads jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare mid uuid; item jsonb; n integer:=0; begin
 if not jobs_private.authorized() then raise exception 'Owner and MFA required' using errcode='42501'; end if;
 if length(message_key)>300 or jsonb_array_length(leads)>100 then raise exception 'Import exceeds limits'; end if;
 insert into public.jobs_alert_messages(source,external_id,received_at,format,lead_count) values(source_name,message_key,received,format_name,jsonb_array_length(leads)) on conflict(source,external_id) do nothing returning id into mid;
 if mid is null then return 0; end if;
 for item in select * from jsonb_array_elements(leads) loop
 insert into public.jobs_leads(message_id,title,company,posting_url,source,received_at,warning) values(mid,left(item->>'title',250),left(coalesce(item->>'company',''),250),item->>'url',source_name,received,coalesce(item->>'warning','')) on conflict(message_id,posting_url) do nothing;
 n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.jobs_ingest_alert(text,text,timestamptz,text,jsonb) from public,anon;
grant execute on function public.jobs_ingest_alert(text,text,timestamptz,text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('jobs-private','jobs-private',false,8388608,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create policy jobs_file_read on storage.objects for select to authenticated using(
 bucket_id='jobs-private' and (select jobs_private.authorized()) and exists(select 1 from public.jobs_documents d where d.object_path=name and d.uploaded)
);
create policy jobs_file_insert on storage.objects for insert to authenticated with check(
 bucket_id='jobs-private' and (select jobs_private.authorized()) and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.jobs_documents d where d.object_path=name and d.state='Draft' and not d.uploaded)
);
-- No update/delete policy: uploaded bytes cannot be replaced. No signed URLs are issued.
revoke all on function jobs_private.audit_application(),jobs_private.touch_application(),jobs_private.protect_document() from public,anon,authenticated;
commit;
