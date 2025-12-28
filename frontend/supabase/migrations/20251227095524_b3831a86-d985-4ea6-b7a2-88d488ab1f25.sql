-- Add new columns to links table for smart routing and UTM
ALTER TABLE public.links 
ADD COLUMN ios_url TEXT,
ADD COLUMN android_url TEXT,
ADD COLUMN utm_source TEXT,
ADD COLUMN utm_medium TEXT,
ADD COLUMN utm_campaign TEXT,
ADD COLUMN utm_term TEXT,
ADD COLUMN utm_content TEXT,
ADD COLUMN meta_pixel_id TEXT,
ADD COLUMN google_analytics_id TEXT,
ADD COLUMN tiktok_pixel_id TEXT;

-- Create tags table
CREATE TABLE public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tags" ON public.tags FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own tags" ON public.tags FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own tags" ON public.tags FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own tags" ON public.tags FOR DELETE USING (auth.uid() = user_id);

-- Create link_tags junction table
CREATE TABLE public.link_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID REFERENCES public.links(id) ON DELETE CASCADE NOT NULL,
  tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(link_id, tag_id)
);

ALTER TABLE public.link_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Link tags are viewable by everyone" ON public.link_tags FOR SELECT USING (true);
CREATE POLICY "Users can manage their link tags" ON public.link_tags FOR INSERT 
WITH CHECK (EXISTS (SELECT 1 FROM public.links WHERE id = link_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete their link tags" ON public.link_tags FOR DELETE 
USING (EXISTS (SELECT 1 FROM public.links WHERE id = link_id AND user_id = auth.uid()));

-- Create bio_pages table for Link-in-Bio feature
CREATE TABLE public.bio_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  username TEXT UNIQUE NOT NULL,
  title TEXT,
  bio TEXT,
  avatar_url TEXT,
  theme TEXT DEFAULT 'default',
  background_color TEXT DEFAULT '#0f172a',
  text_color TEXT DEFAULT '#ffffff',
  button_style TEXT DEFAULT 'rounded',
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.bio_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bio pages are publicly readable" ON public.bio_pages FOR SELECT USING (is_public = true OR auth.uid() = user_id);
CREATE POLICY "Users can insert their own bio page" ON public.bio_pages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own bio page" ON public.bio_pages FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own bio page" ON public.bio_pages FOR DELETE USING (auth.uid() = user_id);

-- Create bio_links table for links on bio pages
CREATE TABLE public.bio_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bio_page_id UUID REFERENCES public.bio_pages(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  position INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.bio_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bio links are publicly readable" ON public.bio_links FOR SELECT 
USING (EXISTS (SELECT 1 FROM public.bio_pages WHERE id = bio_page_id AND (is_public = true OR user_id = auth.uid())));
CREATE POLICY "Users can manage their bio links" ON public.bio_links FOR INSERT 
WITH CHECK (EXISTS (SELECT 1 FROM public.bio_pages WHERE id = bio_page_id AND user_id = auth.uid()));
CREATE POLICY "Users can update their bio links" ON public.bio_links FOR UPDATE 
USING (EXISTS (SELECT 1 FROM public.bio_pages WHERE id = bio_page_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete their bio links" ON public.bio_links FOR DELETE 
USING (EXISTS (SELECT 1 FROM public.bio_pages WHERE id = bio_page_id AND user_id = auth.uid()));

-- Add trigger for bio_pages updated_at
CREATE TRIGGER update_bio_pages_updated_at
  BEFORE UPDATE ON public.bio_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add trigger for bio_links updated_at
CREATE TRIGGER update_bio_links_updated_at
  BEFORE UPDATE ON public.bio_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes
CREATE INDEX idx_tags_user_id ON public.tags(user_id);
CREATE INDEX idx_link_tags_link_id ON public.link_tags(link_id);
CREATE INDEX idx_link_tags_tag_id ON public.link_tags(tag_id);
CREATE INDEX idx_bio_pages_username ON public.bio_pages(username);
CREATE INDEX idx_bio_links_bio_page_id ON public.bio_links(bio_page_id);
CREATE INDEX idx_bio_links_position ON public.bio_links(position);