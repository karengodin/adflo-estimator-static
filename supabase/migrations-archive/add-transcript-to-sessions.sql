ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS transcript jsonb DEFAULT '[]';
