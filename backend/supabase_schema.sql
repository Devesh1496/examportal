/**
 * Supabase Schema Migration Script
 * Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
 */

-- 1. Profiles (RBAC)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'candidate' CHECK (role IN ('admin', 'candidate')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Papers
CREATE TABLE IF NOT EXISTS public.papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  exam_type TEXT,
  exam_date TEXT,
  source_url TEXT,
  pdf_url TEXT,
  website TEXT,
  date_found TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pending',
  total_q INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id)
);

-- 3. Questions
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID REFERENCES public.papers(id) ON DELETE CASCADE,
  q_number INTEGER NOT NULL,
  en TEXT,
  hi TEXT,
  options_en JSONB DEFAULT '[]'::jsonb,
  options_hi JSONB DEFAULT '[]'::jsonb,
  answer INTEGER,
  section TEXT,
  has_passage BOOLEAN DEFAULT FALSE,
  passage_en TEXT,
  passage_hi TEXT,
  q_type TEXT DEFAULT 'mcq',
  image_base64 TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Attempts
CREATE TABLE IF NOT EXISTS public.attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID REFERENCES public.papers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score REAL,
  correct INTEGER,
  wrong INTEGER,
  skipped INTEGER,
  time_taken INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Optional, for now we bypass with service_role in backend)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

-- Simple Policies (Admin sees all, Candidate sees own profile/attempts)
CREATE POLICY "Public papers are viewable by everyone" ON public.papers FOR SELECT USING (TRUE);
CREATE POLICY "Public questions are viewable by everyone" ON public.questions FOR SELECT USING (TRUE);
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can view their own attempts" ON public.attempts FOR SELECT USING (auth.uid() = user_id);
