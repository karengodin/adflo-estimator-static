-- ============================================================
-- Adflo Estimator — Unified Schema
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT).
-- RLS is disabled — this is an internal tool with no auth layer yet.
--
-- WHAT THIS SCRIPT DOES:
--   1. Ensures pgcrypto is available (for gen_random_bytes)
--   2. Creates/updates core estimator tables:
--        questions       — the 37 discovery questions
--        logic_settings  — multipliers, tiers, base hours
--        sessions        — one row per client engagement
--        history         — completed project actuals for accuracy tracking
--   3. Adds missing columns to tables that already exist:
--        questions   ← adds blocker, sow (from tools project)
--        sessions    ← adds share_token, primary_contact, rep_name
--   4. Creates new tables:
--        share_tokens      — public client-facing links per session
--        weight_adjustments — LLM-proposed weight changes pending approval
--   5. Seeds logic_settings (global row) if not present
--   6. Upserts all 37 questions with canonical weights
-- ============================================================

create extension if not exists "pgcrypto";

-- ── 1. questions ──────────────────────────────────────────────────────────────

create table if not exists public.questions (
  id          integer primary key,
  cat         text    not null,
  q           text    not null,
  trigger     text    not null check (trigger in ('Yes','No')),
  weight      integer not null default 0,
  can_remove  boolean not null default false,
  lever_name  text,
  lever_desc  text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  blocker     boolean not null default false,
  sow         boolean not null default false
);

-- Add columns if the table pre-existed without them
alter table public.questions add column if not exists blocker    boolean not null default false;
alter table public.questions add column if not exists sow        boolean not null default false;
alter table public.questions add column if not exists lever_name text;
alter table public.questions add column if not exists lever_desc text;
alter table public.questions add column if not exists sort_order integer not null default 0;
alter table public.questions add column if not exists active     boolean not null default true;

alter table public.questions disable row level security;

-- ── 2. logic_settings ────────────────────────────────────────────────────────

create table if not exists public.logic_settings (
  id                             text    primary key default 'global',
  base_hours                     integer not null default 24,
  best_case_multiplier           numeric not null default 0.8,
  worst_case_multiplier          numeric not null default 1.3,
  learning_blend_cap             numeric not null default 0.6,
  min_projects_for_full_learning integer not null default 20,
  tiers                          jsonb   not null default '[
    {"name":"Bronze",     "min_hours":24,  "timeline":"3–5 weeks"},
    {"name":"Silver",     "min_hours":60,  "timeline":"5–8 weeks"},
    {"name":"Gold",       "min_hours":110, "timeline":"8–12 weeks"},
    {"name":"Enterprise", "min_hours":180, "timeline":"12–16 weeks"}
  ]'::jsonb,
  updated_at  timestamptz default now(),
  updated_by  uuid
);

alter table public.logic_settings disable row level security;

insert into public.logic_settings (id)
values ('global')
on conflict (id) do nothing;

-- ── 3. sessions ───────────────────────────────────────────────────────────────

create table if not exists public.sessions (
  id                uuid        primary key default gen_random_uuid(),
  client_name       text        not null,
  primary_contact   text,
  rep_name          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  status            text        not null default 'draft'
                                check (status in ('draft','submitted','reviewed','closed')),
  answers           jsonb       not null default '{}'::jsonb,
  activated_levers  integer[]   not null default '{}',
  estimated_hours   integer     not null default 0,
  tier              text        not null default 'Bronze',
  notes             text,
  share_token       text        unique default replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '')
);

-- Add columns if the table pre-existed without them
alter table public.sessions add column if not exists primary_contact text;
alter table public.sessions add column if not exists rep_name        text;
alter table public.sessions add column if not exists share_token     text unique default replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '');

-- Back-fill share_token for any existing rows that have null
update public.sessions
set share_token = replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '')
where share_token is null;

-- Normalise activated_levers column type (tools project stored it as jsonb)
-- If it's already integer[] this is a no-op; Supabase won't error on matching type.
-- If migration is needed, run manually:
-- alter table public.sessions alter column activated_levers type integer[] using activated_levers::text::integer[];

alter table public.sessions disable row level security;

-- Auto-update updated_at on any change
create or replace function public.sessions_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sessions_updated_at on public.sessions;
create trigger sessions_updated_at
  before update on public.sessions
  for each row execute procedure public.sessions_set_updated_at();

-- ── 4. history ───────────────────────────────────────────────────────────────

create table if not exists public.history (
  id               uuid        primary key default gen_random_uuid(),
  session_id       uuid        references public.sessions(id) on delete set null,
  client_name      text        not null,
  rep_name         text,
  date_completed   date        not null,
  estimated_hours  integer     not null,
  actual_hours     integer     not null,
  tier             text        not null,
  timeline         text        not null default '',
  answers          jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

alter table public.history add column if not exists timeline text not null default '';
alter table public.history add column if not exists answers  jsonb not null default '{}'::jsonb;

alter table public.history disable row level security;

-- ── 5. share_tokens ──────────────────────────────────────────────────────────
-- Separate table for public client-facing links.
-- Allows multiple tokens per session (e.g. resend), expiry, and usage tracking.

create table if not exists public.share_tokens (
  token       text        primary key default replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', ''),
  session_id  uuid        not null references public.sessions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  used_at     timestamptz
);

alter table public.share_tokens disable row level security;

-- ── 6. weight_adjustments ────────────────────────────────────────────────────
-- Stores LLM-proposed weight changes. Approved = true means applied to questions.

create table if not exists public.weight_adjustments (
  id           uuid        primary key default gen_random_uuid(),
  question_id  integer     not null references public.questions(id) on delete cascade,
  old_weight   integer     not null,
  new_weight   integer     not null,
  reasoning    text,
  approved     boolean,
  created_at   timestamptz not null default now()
);

alter table public.weight_adjustments disable row level security;

-- ── 7. Seed / upsert all 37 questions ────────────────────────────────────────
-- ON CONFLICT updates everything except id so re-running is safe.

insert into public.questions
  (id, cat, q, trigger, weight, can_remove, lever_name, lever_desc, sort_order, active, blocker, sow)
values
-- Data & Structure (8)
(1,  'Data & Structure',              'Do you currently use more than one system to manage orders or campaign data?',        'Yes', 8,  false, null,                        null,                                         1,  true, false, false),
(2,  'Data & Structure',              'Will Adflo be the single source of truth for data?',                                  'Yes', 10, false, null,                        null,                                         2,  true, false, false),
(3,  'Data & Structure',              'Do you have more than 5 unique products or service types?',                           'Yes', 6,  false, null,                        null,                                         3,  true, false, false),
(4,  'Data & Structure',              'Do different products require different fields or data structures?',                   'Yes', 8,  false, null,                        null,                                         4,  true, false, false),
(5,  'Data & Structure',              'Do you need to import historical campaign/order data?',                               'Yes', 12, true,  'Historical Data Import',    'Skip migrating historical data; start fresh', 5,  true, false, false),
(6,  'Data & Structure',              'Do campaigns typically include multiple flights or phases?',                          'Yes', 4,  false, null,                        null,                                         6,  true, false, false),
(7,  'Data & Structure',              'Do multiple departments contribute different data inputs during campaign setup?',      'Yes', 6,  false, null,                        null,                                         7,  true, false, false),
(8,  'Data & Structure',              'Do different teams currently follow different processes for the same campaign type?',  'Yes', 12, false, null,                        null,                                         8,  true, false, false),
-- Workflow & Approvals (4)
(9,  'Workflow & Approvals',          'Do orders require more than one approval step before activation?',                    'Yes', 6,  true,  'Multi-Step Approvals',      'Use single-step approval flow instead',       9,  true, false, false),
(10, 'Workflow & Approvals',          'Do approvals involve multiple departments (Sales, Finance, Ops, etc.)?',              'Yes', 8,  true,  'Cross-Dept Approvals',      'Limit approvals to one department',           10, true, false, false),
(11, 'Workflow & Approvals',          'Do you require conditional workflow routing (if/then rules)?',                        'Yes', 10, true,  'Conditional Routing',       'Use standard linear workflow only',           11, true, false, false),
(12, 'Workflow & Approvals',          'Do you require automated SLA tracking or deadlines in workflows?',                   'Yes', 6,  true,  'SLA Tracking',              'Manual deadline management instead',          12, true, false, false),
-- Integrations (6)
(13, 'Integrations',                  'Will Adflo integrate with a CRM system?',                                             'Yes', 12, true,  'CRM Integration',           'Manual data entry between systems',           13, true, false, false),
(14, 'Integrations',                  'Will Adflo integrate with proposal or quoting tools?',                               'Yes', 8,  true,  'Proposal Tool Integration', 'Remove proposal tool sync',                   14, true, false, false),
(15, 'Integrations',                  'Will Adflo integrate with billing or finance systems?',                              'Yes', 14, true,  'Billing System Integration','Manual billing export instead',               15, true, false, false),
(16, 'Integrations',                  'Will Adflo receive data from external platforms via API/webhook?',                   'Yes', 16, true,  'Inbound API / Webhooks',    'Remove inbound data feeds; manual import',    16, true, false, false),
(17, 'Integrations',                  'Do any integrations require bi-directional syncing?',                                'Yes', 18, true,  'Bi-Directional Sync',       'One-way sync only (Adflo → external)',        17, true, false, false),
(18, 'Integrations',                  'Will you require push connections to external vendors?',                             'Yes', 12, true,  'Push Connectors',           'Remove vendor push connections entirely',      18, true, false, false),
-- Configuration (5)
(19, 'Configuration',                 'Will you require multiple custom order forms?',                                      'Yes', 6,  true,  'Custom Order Forms',        'Use standard order form template',            19, true, false, false),
(20, 'Configuration',                 'Will you require custom product forms?',                                             'Yes', 6,  true,  'Custom Product Forms',      'Use standard product form',                   20, true, false, false),
(21, 'Configuration',                 'Will you require custom task forms?',                                                'Yes', 5,  true,  'Custom Task Forms',         'Use default task structure',                  21, true, false, false),
(22, 'Configuration',                 'Will the platform need to support multiple business units or brands?',               'Yes', 10, true,  'Multi-BU Support',          'Single business unit configuration',           22, true, false, false),
(23, 'Configuration',                 'Will users require different permission levels or roles?',                           'Yes', 6,  false, null,                        null,                                          23, true, false, false),
-- Reporting & Financial Complexity (7)
(24, 'Reporting & Financial Complexity', 'Do you require custom margin tracking?',                                          'Yes', 6,  true,  'Custom Margin Tracking',    'Use standard margin reporting',               24, true, false, false),
(25, 'Reporting & Financial Complexity', 'Do you require custom financial reporting?',                                      'Yes', 6,  true,  'Custom Financial Reports',  'Use out-of-box financial reports',            25, true, false, false),
(26, 'Reporting & Financial Complexity', 'Will campaigns need cost reconciliation?',                                        'Yes', 6,  true,  'Cost Reconciliation',       'Skip reconciliation workflow',                26, true, false, false),
(27, 'Reporting & Financial Complexity', 'Will campaigns need COGS tracking?',                                             'Yes', 6,  true,  'COGS Tracking',             'Remove COGS tracking module',                 27, true, false, false),
(28, 'Reporting & Financial Complexity', 'Do you require billing automation or invoice generation?',                        'Yes', 10, true,  'Billing Automation',        'Manual invoice creation instead',             28, true, false, false),
(29, 'Reporting & Financial Complexity', 'Will campaign revenue need to be adjusted via change orders?',                   'Yes', 6,  true,  'Change Orders',             'No change order module in phase 1',           29, true, false, false),
(30, 'Reporting & Financial Complexity', 'Will you need pacing data during the campaign?',                                  'Yes', 4,  true,  'Pacing Data',               'Post-campaign reporting only',                30, true, false, false),
-- Organizational Readiness (4)  — trigger is 'No' (adds hours when client lacks this)
(31, 'Organizational Readiness',      'Do you have a dedicated internal implementation lead?',                              'No',  12, false, null,                        null,                                          31, true, false, false),
(32, 'Organizational Readiness',      'Do you have a dedicated technical resource for integrations?',                      'No',  10, false, null,                        null,                                          32, true, false, false),
(33, 'Organizational Readiness',      'Do you have documented current workflows?',                                         'No',  10, false, null,                        null,                                          33, true, false, false),
(34, 'Organizational Readiness',      'Do stakeholders agree on how workflows should operate in the future?',               'No',  12, false, null,                        null,                                          34, true, false, false),
-- Scale (3)
(35, 'Scale',                         'Will more than 20 users access the platform?',                                       'Yes', 4,  false, null,                        null,                                          35, true, false, false),
(36, 'Scale',                         'Will more than one team or department use the system?',                              'Yes', 6,  false, null,                        null,                                          36, true, false, false),
(37, 'Scale',                         'Will the platform support more than one geographic market or region?',                'Yes', 6,  true,  'Multi-Region Support',      'Single region launch first',                  37, true, false, false)
on conflict (id) do update set
  cat        = excluded.cat,
  q          = excluded.q,
  trigger    = excluded.trigger,
  weight     = excluded.weight,
  can_remove = excluded.can_remove,
  lever_name = excluded.lever_name,
  lever_desc = excluded.lever_desc,
  sort_order = excluded.sort_order,
  active     = excluded.active;
  -- blocker and sow intentionally NOT overwritten on update
  -- so team customisations survive re-runs

-- ── Done ─────────────────────────────────────────────────────────────────────
-- Tables created or verified: questions, logic_settings, sessions, history,
--                             share_tokens, weight_adjustments
-- The legacy estimator_* tables (estimator_questions, estimator_submissions,
-- estimator_logic, estimator_history) are left untouched. Migrate their data
-- manually once the new tables are confirmed working, then drop them.
