-- =============================================================================
-- adfloXtract Patched Schema v2 — Safe to run against existing Supabase project
-- =============================================================================
--
-- WHAT THIS FILE DOES:
--   Applies the full adfloXtract database schema (ported from the Lovable project)
--   to a Supabase instance that already has other tables in the public schema.
--
-- WHY THIS IS A PATCHED VERSION:
--   The standard xtract-schema.sql includes a CREATE TABLE for "instances" — but
--   that table already exists in this Supabase project (used by
--   adflo-implementation-tools). Rather than drop/replace it, this file adds only
--   the missing "user_id" column and creates everything else from scratch.
--
-- WHAT ALREADY EXISTS (not touched by this file):
--   instances, tapclicks_instances, sessions, questions, logic_settings,
--   history, estimator_submissions, estimator_questions, estimator_logic,
--   estimator_history, usage_log
--
-- WHAT THIS FILE CREATES:
--   Enums:   extraction_type, app_role
--   Tables:  profiles, user_roles, extractions, comparisons,
--            ai_conversations, ai_uploads, folders, instance_folders,
--            migration_projects, migration_stages, migration_runs
--   Patches: instances.user_id (nullable FK to auth.users)
--   Also:    functions, triggers, RLS policies, storage bucket
--
-- EXECUTION ORDER (dependency-safe):
--   1. Extensions
--   2. Enums
--   3. update_updated_at_column() — no table deps, needed by table triggers
--   4. Patch instances table (ADD COLUMN + index + updated_at trigger)
--   5. All new tables — each with PKs, FKs, indexes, updated_at triggers inline
--   6. Functions that reference tables (has_role, handle_new_user, role handlers)
--   7. Auth triggers on auth.users
--   8. Enable RLS on all tables
--   9. RLS policies (has_role must exist before policies that call it)
--  10. Storage bucket + policies
--
-- HOW TO RUN:
--   Paste into the Supabase SQL Editor and execute.
--   Safe to run once — uses IF NOT EXISTS and CREATE OR REPLACE throughout.
--
-- SOURCE:
--   Derived from 18 Lovable migration files dated 2025-12-30 through 2026-04-08.
--   Fixed: reordered so tables exist before functions that reference them.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


-- =============================================================================
-- SECTION 2: Enums
-- (Consolidated from the initial migration + 10 subsequent ALTER TYPE migrations)
-- =============================================================================

CREATE TYPE public.extraction_type AS ENUM (
    'form_fields',
    'form_field_groups',
    'lookups',
    'lookup_details',
    'workflows',
    'workflow_details',
    'tasks',
    'client_forms',
    'client_form_details',
    'order_forms',
    'order_form_details',
    'line_item_forms',
    'line_item_details',
    'flight_forms',
    'task_forms',
    'task_form_details',
    'rules',
    'rule_details',
    'integrations',
    'integration_details',
    'clients',
    'users',
    'client_groups',
    'business_units',
    'queues',
    'queue_details'
);

CREATE TYPE public.app_role AS ENUM ('admin', 'user');


-- =============================================================================
-- SECTION 3: update_updated_at_column()
-- Must exist before any table that uses it as a trigger function.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- SECTION 4: Patch existing "instances" table
-- Skipping CREATE TABLE — table already exists from adflo-implementation-tools.
-- Adding user_id as nullable so existing rows are not broken.
-- adfloXtract RLS policies depend on this column to scope data per user.
-- NOTE: Existing rows will have user_id = NULL and will be invisible to RLS
-- until backfilled: UPDATE instances SET user_id = '<your-uuid>' WHERE ...
-- =============================================================================

ALTER TABLE public.instances
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_instances_user_id
  ON public.instances USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_instances_cookie_expires
  ON public.instances (cookie_expires_at)
  WHERE cookie_expires_at IS NOT NULL;

CREATE OR REPLACE TRIGGER update_instances_updated_at
  BEFORE UPDATE ON public.instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =============================================================================
-- SECTION 5: New tables
-- Each table is created with its PKs, FKs, indexes, and updated_at trigger
-- inline so dependencies within this section are self-contained.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user, auto-created on signup via trigger
-- -----------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- user_roles: admin / user role assignments, one row per user per role
-- -----------------------------------------------------------------------------
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.app_role NOT NULL DEFAULT 'user',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- -----------------------------------------------------------------------------
-- extractions: raw data snapshots pulled from a TapClicks instance.
-- Records are immutable once written (UPDATE blocked by RLS policy below).
-- -----------------------------------------------------------------------------
CREATE TABLE public.extractions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    instance_id uuid NOT NULL,
    extraction_type public.extraction_type NOT NULL,
    data jsonb DEFAULT '[]'::jsonb NOT NULL,
    record_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ui_version text DEFAULT 'old'::text NOT NULL
);

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_instance_id_fkey
    FOREIGN KEY (instance_id) REFERENCES public.instances(id) ON DELETE CASCADE;

CREATE INDEX idx_extractions_user_id ON public.extractions USING btree (user_id);
CREATE INDEX idx_extractions_instance_id ON public.extractions USING btree (instance_id);

-- -----------------------------------------------------------------------------
-- comparisons: diff results between two TapClicks instances
-- -----------------------------------------------------------------------------
CREATE TABLE public.comparisons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    source_instance_id uuid NOT NULL,
    target_instance_id uuid NOT NULL,
    extraction_type public.extraction_type NOT NULL,
    diff_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    missing_in_target integer DEFAULT 0 NOT NULL,
    missing_in_source integer DEFAULT 0 NOT NULL,
    config_differences integer DEFAULT 0 NOT NULL,
    type_mismatches integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.comparisons
    ADD CONSTRAINT comparisons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comparisons
    ADD CONSTRAINT comparisons_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comparisons
    ADD CONSTRAINT comparisons_source_instance_id_fkey
    FOREIGN KEY (source_instance_id) REFERENCES public.instances(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comparisons
    ADD CONSTRAINT comparisons_target_instance_id_fkey
    FOREIGN KEY (target_instance_id) REFERENCES public.instances(id) ON DELETE CASCADE;

CREATE INDEX idx_comparisons_user_id ON public.comparisons USING btree (user_id);

-- -----------------------------------------------------------------------------
-- ai_conversations: chat history for the AI assistant feature
-- -----------------------------------------------------------------------------
CREATE TABLE public.ai_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_ai_conversations_user_id ON public.ai_conversations USING btree (user_id);

CREATE OR REPLACE TRIGGER update_ai_conversations_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- ai_uploads: files attached to AI conversations (stored in 'ai-uploads' bucket)
-- -----------------------------------------------------------------------------
CREATE TABLE public.ai_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
    file_name text NOT NULL,
    file_type text NOT NULL,
    file_path text NOT NULL,
    file_size integer NOT NULL,
    parsed_content jsonb,
    analysis_result jsonb,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- -----------------------------------------------------------------------------
-- folders: user-defined groups for organizing instances
-- -----------------------------------------------------------------------------
CREATE TABLE public.folders (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    color text DEFAULT '#6366f1',
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER update_folders_updated_at
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- instance_folders: many-to-many join — one instance can belong to many folders
-- -----------------------------------------------------------------------------
CREATE TABLE public.instance_folders (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    instance_id uuid NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
    folder_id uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(instance_id, folder_id)
);

-- -----------------------------------------------------------------------------
-- migration_projects: top-level container for a TapClicks migration workflow
-- -----------------------------------------------------------------------------
CREATE TABLE public.migration_projects (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    instance_id uuid REFERENCES public.instances(id) ON DELETE SET NULL,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'active',
    current_step integer NOT NULL DEFAULT 1,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER update_migration_projects_updated_at
  BEFORE UPDATE ON public.migration_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- migration_stages: individual steps within a migration project
-- -----------------------------------------------------------------------------
CREATE TABLE public.migration_stages (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
    stage_number integer NOT NULL,
    stage_name text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    input_data jsonb DEFAULT '{}'::jsonb,
    output_data jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(project_id, stage_number)
);

CREATE OR REPLACE TRIGGER update_migration_stages_updated_at
  BEFORE UPDATE ON public.migration_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- migration_runs: log of actual migration executions with per-item results
-- -----------------------------------------------------------------------------
CREATE TABLE public.migration_runs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    instance_id uuid NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
    item_type text NOT NULL,
    results jsonb NOT NULL DEFAULT '[]'::jsonb,
    total_items integer NOT NULL DEFAULT 0,
    success_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    partial_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);


-- =============================================================================
-- SECTION 6: Functions that reference tables
-- These must come AFTER the tables they reference.
-- =============================================================================

-- Looks up user_roles to check if a user has a given role.
-- SECURITY DEFINER prevents RLS recursion when policies call this function.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Inserts a profile row when a new user signs up (fires via auth trigger below)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  RETURN new;
END;
$$;

-- Auto-assigns 'user' role to every new signup
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

-- Auto-assigns 'admin' role to the designated admin email on signup
CREATE OR REPLACE FUNCTION public.handle_admin_auto_assign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email = 'karen.godin@tapclicks.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


-- =============================================================================
-- SECTION 7: Auth triggers on auth.users
-- Must come after the functions they call (Section 6).
-- =============================================================================

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE TRIGGER on_auth_user_created_add_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

CREATE OR REPLACE TRIGGER on_auth_user_created_assign_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_admin_auto_assign();

-- Backfill 'user' role for any existing profiles that predate this migration
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'user'::public.app_role
FROM public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.id
WHERE ur.id IS NULL
ON CONFLICT (user_id, role) DO NOTHING;


-- =============================================================================
-- SECTION 8: Enable Row Level Security on all tables
-- =============================================================================

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instances          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extractions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparisons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_uploads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instance_folders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_stages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_runs     ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- SECTION 9: RLS Policies
-- Must come after Section 8 (RLS enabled) and after has_role() exists (Section 6).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete profiles"
  ON public.profiles FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- user_roles
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update roles"
  ON public.user_roles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- instances (patched table — policies scoped by the new user_id column)
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own instances"
  ON public.instances FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own instances"
  ON public.instances FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own instances"
  ON public.instances FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own instances"
  ON public.instances FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- extractions (immutable — UPDATE explicitly blocked)
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own extractions"
  ON public.extractions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own extractions"
  ON public.extractions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own extractions"
  ON public.extractions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Extractions are immutable"
  ON public.extractions FOR UPDATE USING (false);

-- -----------------------------------------------------------------------------
-- comparisons
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own comparisons"
  ON public.comparisons FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own comparisons"
  ON public.comparisons FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own comparisons"
  ON public.comparisons FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- ai_conversations
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own conversations"
  ON public.ai_conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own conversations"
  ON public.ai_conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own conversations"
  ON public.ai_conversations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own conversations"
  ON public.ai_conversations FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- ai_uploads
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own uploads"
  ON public.ai_uploads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own uploads"
  ON public.ai_uploads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own uploads"
  ON public.ai_uploads FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- folders
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own folders"
  ON public.folders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own folders"
  ON public.folders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own folders"
  ON public.folders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own folders"
  ON public.folders FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- instance_folders (access controlled through folder ownership)
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their instance_folders"
  ON public.instance_folders FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.folders
      WHERE folders.id = instance_folders.folder_id
        AND folders.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can create instance_folders"
  ON public.instance_folders FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.folders
      WHERE folders.id = instance_folders.folder_id
        AND folders.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete instance_folders"
  ON public.instance_folders FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.folders
      WHERE folders.id = instance_folders.folder_id
        AND folders.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- migration_projects
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own migration projects"
  ON public.migration_projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own migration projects"
  ON public.migration_projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own migration projects"
  ON public.migration_projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own migration projects"
  ON public.migration_projects FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- migration_stages (access controlled through project ownership)
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own migration stages"
  ON public.migration_stages FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.migration_projects
            WHERE id = migration_stages.project_id AND user_id = auth.uid())
  );
CREATE POLICY "Users can create their own migration stages"
  ON public.migration_stages FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.migration_projects
            WHERE id = migration_stages.project_id AND user_id = auth.uid())
  );
CREATE POLICY "Users can update their own migration stages"
  ON public.migration_stages FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.migration_projects
            WHERE id = migration_stages.project_id AND user_id = auth.uid())
  );
CREATE POLICY "Users can delete their own migration stages"
  ON public.migration_stages FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.migration_projects
            WHERE id = migration_stages.project_id AND user_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- migration_runs
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view their own migration runs"
  ON public.migration_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own migration runs"
  ON public.migration_runs FOR INSERT WITH CHECK (auth.uid() = user_id);


-- =============================================================================
-- SECTION 10: Storage bucket for AI file uploads
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
  VALUES ('ai-uploads', 'ai-uploads', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload to ai-uploads bucket"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'ai-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own ai-uploads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ai-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own ai-uploads"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'ai-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);


-- =============================================================================
-- Done.
-- Tables created: profiles, user_roles, extractions, comparisons,
--                 ai_conversations, ai_uploads, folders, instance_folders,
--                 migration_projects, migration_stages, migration_runs
-- Table patched:  instances (added user_id column)
-- =============================================================================
