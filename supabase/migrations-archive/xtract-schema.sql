-- =============================================================================
-- adfloXtract Complete Database Schema
-- Generated from Lovable migration files in chronological order
-- Run this against a fresh Supabase project to recreate the full schema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Migration: 20251230205243_remix_migration_from_pg_dump.sql
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
BEGIN;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: extraction_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.extraction_type AS ENUM (
    'form_fields',
    'form_field_groups',
    'lookups',
    'workflows',
    'tasks',
    'client_forms',
    'order_forms',
    'line_item_forms',
    'flight_forms',
    'task_forms',
    'rules'
);


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  RETURN new;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comparisons; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: extractions; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    base_url text NOT NULL,
    session_cookie text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_connected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);


--
-- Name: comparisons comparisons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparisons
    ADD CONSTRAINT comparisons_pkey PRIMARY KEY (id);


--
-- Name: extractions extractions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_pkey PRIMARY KEY (id);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: idx_ai_conversations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversations_user_id ON public.ai_conversations USING btree (user_id);


--
-- Name: idx_comparisons_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comparisons_user_id ON public.comparisons USING btree (user_id);


--
-- Name: idx_extractions_instance_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extractions_instance_id ON public.extractions USING btree (instance_id);


--
-- Name: idx_extractions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extractions_user_id ON public.extractions USING btree (user_id);


--
-- Name: idx_instances_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instances_user_id ON public.instances USING btree (user_id);


--
-- Name: ai_conversations update_ai_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ai_conversations_updated_at BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: instances update_instances_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_instances_updated_at BEFORE UPDATE ON public.instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_conversations ai_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: comparisons comparisons_source_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparisons
    ADD CONSTRAINT comparisons_source_instance_id_fkey FOREIGN KEY (source_instance_id) REFERENCES public.instances(id) ON DELETE CASCADE;


--
-- Name: comparisons comparisons_target_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparisons
    ADD CONSTRAINT comparisons_target_instance_id_fkey FOREIGN KEY (target_instance_id) REFERENCES public.instances(id) ON DELETE CASCADE;


--
-- Name: comparisons comparisons_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparisons
    ADD CONSTRAINT comparisons_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: extractions extractions_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.instances(id) ON DELETE CASCADE;


--
-- Name: extractions extractions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: instances instances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instances
    ADD CONSTRAINT instances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: comparisons Users can create their own comparisons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own comparisons" ON public.comparisons FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: ai_conversations Users can create their own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own conversations" ON public.ai_conversations FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: extractions Users can create their own extractions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own extractions" ON public.extractions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: instances Users can create their own instances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own instances" ON public.instances FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: comparisons Users can delete their own comparisons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own comparisons" ON public.comparisons FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: ai_conversations Users can delete their own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own conversations" ON public.ai_conversations FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: extractions Users can delete their own extractions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own extractions" ON public.extractions FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: instances Users can delete their own instances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own instances" ON public.instances FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: ai_conversations Users can update their own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own conversations" ON public.ai_conversations FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: instances Users can update their own instances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own instances" ON public.instances FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: comparisons Users can view their own comparisons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own comparisons" ON public.comparisons FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: ai_conversations Users can view their own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own conversations" ON public.ai_conversations FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: extractions Users can view their own extractions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own extractions" ON public.extractions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: instances Users can view their own instances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own instances" ON public.instances FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: ai_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: comparisons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comparisons ENABLE ROW LEVEL SECURITY;

--
-- Name: extractions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.extractions ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




COMMIT;

-- -----------------------------------------------------------------------------
-- Migration: 20251231193002_08addd1c-8fc9-4449-b276-e3657692192b.sql
-- -----------------------------------------------------------------------------

-- Add UPDATE policy to extractions table to explicitly block updates (immutable records)
CREATE POLICY "Extractions are immutable" 
ON public.extractions 
FOR UPDATE 
USING (false);

-- -----------------------------------------------------------------------------
-- Migration: 20251231194141_a67c8ba3-4ae7-4fea-83ae-44684c957573.sql
-- -----------------------------------------------------------------------------

-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check user role (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
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

-- RLS policies for user_roles table
-- Users can view their own roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

-- Admins can view all roles
CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Admins can insert roles
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admins can update roles
CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

-- Admins can delete roles
CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- Update profiles RLS: Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Admins can update any profile
CREATE POLICY "Admins can update any profile"
ON public.profiles
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

-- Admins can delete any profile
CREATE POLICY "Admins can delete profiles"
ON public.profiles
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- Create trigger to auto-assign 'user' role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
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

CREATE TRIGGER on_auth_user_created_add_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- -----------------------------------------------------------------------------
-- Migration: 20251231194511_4bf37007-bdfc-4b8b-b5ef-49f8b8a5ffbf.sql
-- -----------------------------------------------------------------------------

-- Create a function to auto-assign admin role to specific email on signup
CREATE OR REPLACE FUNCTION public.handle_admin_auto_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if this is the designated admin email
  IF NEW.email = 'karen.godin@tapclicks.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger that runs after the user role trigger
CREATE TRIGGER on_auth_user_created_assign_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_admin_auto_assign();

-- Add user roles for any existing users who don't have them
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'user'::app_role
FROM public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.id
WHERE ur.id IS NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Migration: 20251231204241_ddbeca6d-1b97-40fa-adaa-dba625f75f98.sql
-- -----------------------------------------------------------------------------

-- Add new extraction types for detailed exports
ALTER TYPE extraction_type ADD VALUE IF NOT EXISTS 'workflow_details';
ALTER TYPE extraction_type ADD VALUE IF NOT EXISTS 'line_item_details';

-- -----------------------------------------------------------------------------
-- Migration: 20260105210946_ee6e9ffe-ec1e-451b-8850-75686fbd88c9.sql
-- -----------------------------------------------------------------------------

-- Add new extraction types for integrations
ALTER TYPE extraction_type ADD VALUE IF NOT EXISTS 'integrations';
ALTER TYPE extraction_type ADD VALUE IF NOT EXISTS 'integration_details';

-- -----------------------------------------------------------------------------
-- Migration: 20260106220239_1b24b5c8-d0a3-416a-9991-dd1abc1648cb.sql
-- -----------------------------------------------------------------------------

ALTER TYPE extraction_type ADD VALUE 'clients';
ALTER TYPE extraction_type ADD VALUE 'users';
ALTER TYPE extraction_type ADD VALUE 'client_groups';
ALTER TYPE extraction_type ADD VALUE 'business_units';

-- -----------------------------------------------------------------------------
-- Migration: 20260107160847_8d4b113a-31b9-4c22-a1ce-051cc0a719a5.sql
-- -----------------------------------------------------------------------------

ALTER TABLE public.instances ADD COLUMN display_order integer NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- Migration: 20260107161351_e55c90d4-bf1e-4372-a29e-ec9a6ab99217.sql
-- -----------------------------------------------------------------------------

-- Create trigger for new user profile creation
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Migration: 20260107171248_b3bd63a7-8a53-48d3-bfd3-57ec3d808a92.sql
-- -----------------------------------------------------------------------------

-- Add new extraction types for entity form details
ALTER TYPE extraction_type ADD VALUE 'client_form_details';
ALTER TYPE extraction_type ADD VALUE 'order_form_details';
ALTER TYPE extraction_type ADD VALUE 'task_form_details';

-- -----------------------------------------------------------------------------
-- Migration: 20260107221238_217aaeed-83c4-4fec-85eb-71ba66f01c15.sql
-- -----------------------------------------------------------------------------

-- Add cookie_expires_at column to track cookie expiry dates
ALTER TABLE instances ADD COLUMN cookie_expires_at timestamptz;

-- Create index for efficient cleanup queries
CREATE INDEX idx_instances_cookie_expires ON instances (cookie_expires_at) 
WHERE cookie_expires_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Migration: 20260107223902_c7d94ddf-f7cd-4a9e-aae9-e5001834b909.sql
-- -----------------------------------------------------------------------------

-- Create storage bucket for AI uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('ai-uploads', 'ai-uploads', false);

-- Create table to track uploaded files
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

-- Enable RLS
ALTER TABLE public.ai_uploads ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_uploads
CREATE POLICY "Users can view their own uploads" ON public.ai_uploads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own uploads" ON public.ai_uploads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own uploads" ON public.ai_uploads
  FOR DELETE USING (auth.uid() = user_id);

-- Storage policies for ai-uploads bucket
CREATE POLICY "Users can upload to ai-uploads bucket" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'ai-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own ai-uploads" ON storage.objects
  FOR SELECT USING (bucket_id = 'ai-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own ai-uploads" ON storage.objects
  FOR DELETE USING (bucket_id = 'ai-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

-- -----------------------------------------------------------------------------
-- Migration: 20260109214144_4b370654-31f6-4084-a370-92c625812517.sql
-- -----------------------------------------------------------------------------

-- Add 'rule_details' to the extraction_type enum
ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'rule_details';

-- -----------------------------------------------------------------------------
-- Migration: 20260112202204_eab46dc0-8ef1-498b-ad97-00593a22a229.sql
-- -----------------------------------------------------------------------------

-- Add lookup_details to extraction_type enum
ALTER TYPE extraction_type ADD VALUE IF NOT EXISTS 'lookup_details';

-- -----------------------------------------------------------------------------
-- Migration: 20260202214622_00453e18-72a5-4794-9a9b-a09418eec4ea.sql
-- -----------------------------------------------------------------------------

-- Create folders table
CREATE TABLE public.folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create junction table for many-to-many relationship
CREATE TABLE public.instance_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(instance_id, folder_id)
);

-- Enable RLS on folders
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own folders"
ON public.folders FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own folders"
ON public.folders FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own folders"
ON public.folders FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own folders"
ON public.folders FOR DELETE
USING (auth.uid() = user_id);

-- Enable RLS on instance_folders
ALTER TABLE public.instance_folders ENABLE ROW LEVEL SECURITY;

-- Users can manage instance_folders if they own the folder
CREATE POLICY "Users can view their instance_folders"
ON public.instance_folders FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.folders 
    WHERE folders.id = instance_folders.folder_id 
    AND folders.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create instance_folders"
ON public.instance_folders FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.folders 
    WHERE folders.id = instance_folders.folder_id 
    AND folders.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete instance_folders"
ON public.instance_folders FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.folders 
    WHERE folders.id = instance_folders.folder_id 
    AND folders.user_id = auth.uid()
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_folders_updated_at
BEFORE UPDATE ON public.folders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- Migration: 20260206152637_3cb57291-e553-4df7-933f-156ba05960f8.sql
-- -----------------------------------------------------------------------------

-- Add queue extraction types to the enum
ALTER TYPE extraction_type ADD VALUE IF NOT EXISTS 'queues';
ALTER TYPE extraction_type ADD VALUE IF NOT EXISTS 'queue_details';

-- -----------------------------------------------------------------------------
-- Migration: 20260305153743_e5837d28-56aa-46c0-ad1d-ac3843c3652c.sql
-- -----------------------------------------------------------------------------


-- Migration projects table
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

ALTER TABLE public.migration_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own migration projects" ON public.migration_projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own migration projects" ON public.migration_projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own migration projects" ON public.migration_projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own migration projects" ON public.migration_projects FOR DELETE USING (auth.uid() = user_id);

-- Migration stages table
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

ALTER TABLE public.migration_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own migration stages" ON public.migration_stages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.migration_projects WHERE id = migration_stages.project_id AND user_id = auth.uid())
);
CREATE POLICY "Users can create their own migration stages" ON public.migration_stages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.migration_projects WHERE id = migration_stages.project_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update their own migration stages" ON public.migration_stages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.migration_projects WHERE id = migration_stages.project_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete their own migration stages" ON public.migration_stages FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.migration_projects WHERE id = migration_stages.project_id AND user_id = auth.uid())
);

-- Updated at trigger
CREATE TRIGGER update_migration_projects_updated_at BEFORE UPDATE ON public.migration_projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_migration_stages_updated_at BEFORE UPDATE ON public.migration_stages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------------------------
-- Migration: 20260408133746_b4461997-025d-40b9-a25c-e864d532ac41.sql
-- -----------------------------------------------------------------------------


CREATE TABLE public.migration_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_items INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  partial_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.migration_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own migration runs"
  ON public.migration_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own migration runs"
  ON public.migration_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);


