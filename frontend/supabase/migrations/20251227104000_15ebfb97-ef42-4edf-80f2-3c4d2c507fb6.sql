-- Add password protection and geo-targeting columns to links table
ALTER TABLE public.links 
ADD COLUMN IF NOT EXISTS password_hash TEXT,
ADD COLUMN IF NOT EXISTS password_hint TEXT;

-- Create geo_rules table for country-based routing
CREATE TABLE IF NOT EXISTS public.geo_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  redirect_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on geo_rules
ALTER TABLE public.geo_rules ENABLE ROW LEVEL SECURITY;

-- RLS policies for geo_rules
CREATE POLICY "Geo rules are viewable by everyone" 
ON public.geo_rules 
FOR SELECT 
USING (true);

CREATE POLICY "Users can insert their geo rules" 
ON public.geo_rules 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.links 
  WHERE links.id = geo_rules.link_id 
  AND links.user_id = auth.uid()
));

CREATE POLICY "Users can update their geo rules" 
ON public.geo_rules 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM public.links 
  WHERE links.id = geo_rules.link_id 
  AND links.user_id = auth.uid()
));

CREATE POLICY "Users can delete their geo rules" 
ON public.geo_rules 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM public.links 
  WHERE links.id = geo_rules.link_id 
  AND links.user_id = auth.uid()
));

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_geo_rules_link_id ON public.geo_rules(link_id);
CREATE INDEX IF NOT EXISTS idx_geo_rules_country ON public.geo_rules(country_code);