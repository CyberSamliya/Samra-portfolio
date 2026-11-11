import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const OWNER = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";
const APP = "33333333-3333-4333-8333-333333333333",
  DOC = "44444444-4444-4444-8444-444444444444";
const PATH = [OWNER, APP, DOC].join("/");
test("Postgres RLS, MFA, immutable files, audit and idempotent imports", async (t) => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 insert into auth.users values('${OWNER}'),('${OTHER}');
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth,storage to anon,authenticated;grant execute on all functions in schema auth to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/202611110001_jobs.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(`insert into jobs_private.owner values(true,'${OWNER}');`);
  async function as(role, claims, fn) {
    await db.exec(
      `set role ${role};select set_config('request.jwt.claims','${JSON.stringify(claims)}',false);`,
    );
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }
  await as("authenticated", { sub: OWNER, aal: "aal2" }, async () => {
    await db.exec(`insert into public.jobs_applications(id,title,company,posting_url,normalized_url) values('${APP}','SOC Analyst I','Synthetic Example','https://example.com/jobs/1','https://example.com/jobs/1');
  insert into public.jobs_documents(id,application_id,kind,version,object_path,filename,mime_type) values('${DOC}','${APP}','Resume','v1','${PATH}','resume.pdf','application/pdf');
  insert into storage.objects(bucket_id,name) values('jobs-private','${PATH}');
  update public.jobs_documents set uploaded=true where id='${DOC}';`);
  });
  for (const [label, role, claims] of [
    ["signed out", "anon", {}],
    [
      "non-owner",
      "authenticated",
      { sub: OTHER, aal: "aal2", user_metadata: { role: "owner" } },
    ],
    ["owner without MFA", "authenticated", { sub: OWNER, aal: "aal1" }],
  ]) {
    await t.test(
      label + " cannot read/write/export/download any private data",
      async () => {
        await as(role, claims, async () => {
          for (const table of [
            "profiles",
            "applications",
            "documents",
            "history",
            "settings",
            "alert_messages",
            "leads",
            "import_state",
          ]) {
            if (role === "anon")
              await assert.rejects(
                db.query("select * from public.jobs_" + table),
                /permission denied/,
              );
            else
              assert.equal(
                (await db.query("select * from public.jobs_" + table)).rows
                  .length,
                0,
                table,
              );
          }
          assert.equal(
            (
              await db.query(
                "select * from storage.objects where bucket_id='jobs-private'",
              )
            ).rows.length,
            0,
          );
          await assert.rejects(
            db.exec(
              `insert into public.jobs_profiles(name,track) values('attack','Cybersecurity')`,
            ),
            /permission denied|row-level security/,
          );
          if (role === "authenticated") {
            assert.equal(
              (await db.query("select public.jobs_authorized() allowed"))
                .rows[0].allowed,
              false,
            );
            await assert.rejects(
              db.exec(
                `select public.jobs_mark_applied('${APP}',array['${DOC}']::uuid[],current_date)`,
              ),
              /Owner and MFA/,
            );
            await assert.rejects(
              db.exec(
                `select public.jobs_ingest_alert('Gmail','id',now(),'text','[]')`,
              ),
              /Owner and MFA/,
            );
            const result = await db.query(
              `update public.jobs_applications set notes='attack' where id='${APP}' returning id`,
            );
            assert.equal(result.rows.length, 0);
          }
          await assert.rejects(
            db.exec(
              `insert into storage.objects(bucket_id,name) values('jobs-private','${PATH}/attack')`,
            ),
            /row-level security/,
          );
          await assert.rejects(
            db.query("select * from jobs_private.owner"),
            /permission denied/,
          );
        });
      },
    );
  }
  await t.test(
    "owner MFA access, timestamped history, exact duplicates, file versions",
    async () => {
      await as("authenticated", { sub: OWNER, aal: "aal2" }, async () => {
        assert.equal(
          (await db.query("select public.jobs_authorized() allowed")).rows[0]
            .allowed,
          true,
        );
        assert.equal(
          (await db.query("select * from storage.objects")).rows.length,
          1,
        );
        await assert.rejects(
          db.exec(
            `insert into public.jobs_applications(title,company,posting_url,normalized_url) values('Other','Other','https://example.com/jobs/1','https://example.com/jobs/1')`,
          ),
          /duplicate key/,
        );
        await db.exec(
          `insert into public.jobs_applications(title,company,posting_url,normalized_url) values('SOC Analyst I','Synthetic Example','https://example.com/jobs/2','https://example.com/jobs/2')`,
        );
        await db.exec(
          `select public.jobs_mark_applied('${APP}',array['${DOC}']::uuid[],current_date)`,
        );
        const app = (
          await db.query(
            `select * from public.jobs_applications where id='${APP}'`,
          )
        ).rows[0];
        assert.equal(app.status, "Applied");
        assert.deepEqual(app.submitted_document_ids, [DOC]);
        assert.equal(
          (
            await db.query(
              `select * from public.jobs_history where application_id='${APP}'`,
            )
          ).rows.length,
          2,
        );
        await assert.rejects(
          db.exec(
            `update public.jobs_documents set draft_text='changed' where id='${DOC}'`,
          ),
          /immutable/,
        );
        assert.equal(
          (
            await db.query(
              `update storage.objects set name='replacement' returning *`,
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (await db.query(`delete from storage.objects returning *`)).rows
            .length,
          0,
        );
        await assert.rejects(
          db.exec(
            `insert into public.jobs_history(application_id,actor,after_record) values('${APP}','${OWNER}','{}')`,
          ),
          /permission denied/,
        );
      });
    },
  );
  await t.test(
    "multi-job import is atomic and retry-safe, email cannot change application status",
    async () => {
      await as("authenticated", { sub: OWNER, aal: "aal2" }, async () => {
        const leads = [
          { title: "Role 1", url: "https://example.com/1" },
          { title: "Role 2", url: "https://example.com/2" },
        ];
        const ingest = () =>
          db.query("select public.jobs_ingest_alert($1,$2,now(),$3,$4) count", [
            "Gmail",
            "message-1",
            "synthetic",
            JSON.stringify(leads),
          ]);
        assert.equal((await ingest()).rows[0].count, 2);
        assert.equal((await ingest()).rows[0].count, 0);
        assert.equal(
          (await db.query("select * from public.jobs_leads")).rows.length,
          2,
        );
        assert.equal(
          (
            await db.query(
              `select status from public.jobs_applications where id='${APP}'`,
            )
          ).rows[0].status,
          "Applied",
        );
      });
    },
  );
  await db.close();
});
