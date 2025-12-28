import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export interface Link {
  id: string;
  user_id: string;
  original_url: string;
  short_code: string;
  custom_alias: string | null;
  title: string | null;
  is_active: boolean;
  expires_at: string | null;
  ios_url: string | null;
  android_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  meta_pixel_id: string | null;
  google_analytics_id: string | null;
  tiktok_pixel_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkWithClicks extends Link {
  clicks_count: number;
}

interface CreateLinkParams {
  originalUrl: string;
  customAlias?: string;
  iosUrl?: string;
  androidUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  metaPixelId?: string;
  googleAnalyticsId?: string;
  tagIds?: string[];
}

const generateShortCode = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const useLinks = () => {
  const [links, setLinks] = useState<LinkWithClicks[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchLinks = async () => {
    if (!user) {
      setLinks([]);
      setLoading(false);
      return;
    }

    try {
      const { data: linksData, error: linksError } = await supabase
        .from("links")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (linksError) throw linksError;

      // Fetch click counts for each link
      const linksWithClicks = await Promise.all(
        (linksData || []).map(async (link) => {
          const { count } = await supabase
            .from("clicks")
            .select("*", { count: "exact", head: true })
            .eq("link_id", link.id);

          return {
            ...link,
            clicks_count: count || 0,
          };
        })
      );

      setLinks(linksWithClicks);
    } catch (error) {
      console.error("Error fetching links:", error);
      toast.error("Failed to fetch links");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, [user]);

  const createLink = async (params: CreateLinkParams) => {
    if (!user) {
      toast.error("Please sign in to create links");
      return null;
    }

    try {
      const shortCode = params.customAlias || generateShortCode();

      // Check if short code already exists
      const { data: existing } = await supabase
        .from("links")
        .select("id")
        .or(`short_code.eq.${shortCode},custom_alias.eq.${shortCode}`)
        .maybeSingle();

      if (existing) {
        toast.error("This alias is already taken");
        return null;
      }

      const { data, error } = await supabase
        .from("links")
        .insert({
          user_id: user.id,
          original_url: params.originalUrl,
          short_code: shortCode,
          custom_alias: params.customAlias || null,
          ios_url: params.iosUrl || null,
          android_url: params.androidUrl || null,
          utm_source: params.utmSource || null,
          utm_medium: params.utmMedium || null,
          utm_campaign: params.utmCampaign || null,
          meta_pixel_id: params.metaPixelId || null,
          google_analytics_id: params.googleAnalyticsId || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Add tags if provided
      if (params.tagIds && params.tagIds.length > 0) {
        const linkTags = params.tagIds.map((tagId) => ({
          link_id: data.id,
          tag_id: tagId,
        }));

        await supabase.from("link_tags").insert(linkTags);
      }

      await fetchLinks();
      return data;
    } catch (error) {
      console.error("Error creating link:", error);
      toast.error("Failed to create link");
      return null;
    }
  };

  const deleteLink = async (linkId: string) => {
    try {
      const { error } = await supabase
        .from("links")
        .delete()
        .eq("id", linkId);

      if (error) throw error;

      setLinks((prev) => prev.filter((link) => link.id !== linkId));
      toast.success("Link deleted");
    } catch (error) {
      console.error("Error deleting link:", error);
      toast.error("Failed to delete link");
    }
  };

  const updateLink = async (linkId: string, updates: Partial<Link>) => {
    try {
      const { error } = await supabase
        .from("links")
        .update(updates)
        .eq("id", linkId);

      if (error) throw error;
      await fetchLinks();
      toast.success("Link updated");
    } catch (error) {
      console.error("Error updating link:", error);
      toast.error("Failed to update link");
    }
  };

  return {
    links,
    loading,
    createLink,
    deleteLink,
    updateLink,
    refetch: fetchLinks,
  };
};
