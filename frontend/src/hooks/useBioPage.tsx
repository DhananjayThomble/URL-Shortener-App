import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export interface BioPage {
  id: string;
  user_id: string;
  username: string;
  title: string | null;
  bio: string | null;
  avatar_url: string | null;
  theme: string;
  background_color: string;
  text_color: string;
  button_style: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface BioLink {
  id: string;
  bio_page_id: string;
  title: string;
  url: string;
  icon: string | null;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const useBioPage = () => {
  const [bioPage, setBioPage] = useState<BioPage | null>(null);
  const [bioLinks, setBioLinks] = useState<BioLink[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchBioPage = async () => {
    if (!user) {
      setBioPage(null);
      setBioLinks([]);
      setLoading(false);
      return;
    }

    try {
      const { data: page, error: pageError } = await supabase
        .from("bio_pages")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (pageError) throw pageError;
      setBioPage(page);

      if (page) {
        const { data: links, error: linksError } = await supabase
          .from("bio_links")
          .select("*")
          .eq("bio_page_id", page.id)
          .order("position");

        if (linksError) throw linksError;
        setBioLinks(links || []);
      }
    } catch (error) {
      console.error("Error fetching bio page:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBioPage();
  }, [user]);

  const createBioPage = async (username: string) => {
    if (!user) {
      toast.error("Please sign in to create a bio page");
      return null;
    }

    try {
      // Check if username is taken
      const { data: existing } = await supabase
        .from("bio_pages")
        .select("id")
        .eq("username", username)
        .maybeSingle();

      if (existing) {
        toast.error("This username is already taken");
        return null;
      }

      const { data, error } = await supabase
        .from("bio_pages")
        .insert({
          user_id: user.id,
          username,
        })
        .select()
        .single();

      if (error) throw error;
      setBioPage(data);
      toast.success("Bio page created!");
      return data;
    } catch (error) {
      console.error("Error creating bio page:", error);
      toast.error("Failed to create bio page");
      return null;
    }
  };

  const updateBioPage = async (updates: Partial<BioPage>) => {
    if (!bioPage) return;

    try {
      const { error } = await supabase
        .from("bio_pages")
        .update(updates)
        .eq("id", bioPage.id);

      if (error) throw error;
      setBioPage({ ...bioPage, ...updates });
      toast.success("Bio page updated!");
    } catch (error) {
      console.error("Error updating bio page:", error);
      toast.error("Failed to update bio page");
    }
  };

  const addBioLink = async (title: string, url: string, icon?: string) => {
    if (!bioPage) {
      toast.error("Please create a bio page first");
      return null;
    }

    try {
      const position = bioLinks.length;
      const { data, error } = await supabase
        .from("bio_links")
        .insert({
          bio_page_id: bioPage.id,
          title,
          url,
          icon,
          position,
        })
        .select()
        .single();

      if (error) throw error;
      setBioLinks([...bioLinks, data]);
      toast.success("Link added!");
      return data;
    } catch (error) {
      console.error("Error adding bio link:", error);
      toast.error("Failed to add link");
      return null;
    }
  };

  const updateBioLink = async (linkId: string, updates: Partial<BioLink>) => {
    try {
      const { error } = await supabase
        .from("bio_links")
        .update(updates)
        .eq("id", linkId);

      if (error) throw error;
      setBioLinks((prev) =>
        prev.map((link) => (link.id === linkId ? { ...link, ...updates } : link))
      );
      toast.success("Link updated!");
    } catch (error) {
      console.error("Error updating bio link:", error);
      toast.error("Failed to update link");
    }
  };

  const deleteBioLink = async (linkId: string) => {
    try {
      const { error } = await supabase
        .from("bio_links")
        .delete()
        .eq("id", linkId);

      if (error) throw error;
      setBioLinks((prev) => prev.filter((link) => link.id !== linkId));
      toast.success("Link deleted!");
    } catch (error) {
      console.error("Error deleting bio link:", error);
      toast.error("Failed to delete link");
    }
  };

  const reorderBioLinks = async (newOrder: string[]) => {
    try {
      const updates = newOrder.map((id, index) => ({
        id,
        position: index,
      }));

      for (const update of updates) {
        await supabase
          .from("bio_links")
          .update({ position: update.position })
          .eq("id", update.id);
      }

      setBioLinks((prev) =>
        [...prev].sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id))
      );
    } catch (error) {
      console.error("Error reordering links:", error);
      toast.error("Failed to reorder links");
    }
  };

  return {
    bioPage,
    bioLinks,
    loading,
    createBioPage,
    updateBioPage,
    addBioLink,
    updateBioLink,
    deleteBioLink,
    reorderBioLinks,
    refetch: fetchBioPage,
  };
};

// Hook for fetching a public bio page by username
export const usePublicBioPage = (username: string) => {
  const [bioPage, setBioPage] = useState<BioPage | null>(null);
  const [bioLinks, setBioLinks] = useState<BioLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchPublicBioPage = async () => {
      try {
        const { data: page, error: pageError } = await supabase
          .from("bio_pages")
          .select("*")
          .eq("username", username)
          .eq("is_public", true)
          .maybeSingle();

        if (pageError) throw pageError;
        
        if (!page) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        setBioPage(page);

        const { data: links, error: linksError } = await supabase
          .from("bio_links")
          .select("*")
          .eq("bio_page_id", page.id)
          .eq("is_active", true)
          .order("position");

        if (linksError) throw linksError;
        setBioLinks(links || []);
      } catch (error) {
        console.error("Error fetching public bio page:", error);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    if (username) {
      fetchPublicBioPage();
    }
  }, [username]);

  return { bioPage, bioLinks, loading, notFound };
};
