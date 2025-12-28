import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

export const useTags = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchTags = async () => {
    if (!user) {
      setTags([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .eq("user_id", user.id)
        .order("name");

      if (error) throw error;
      setTags(data || []);
    } catch (error) {
      console.error("Error fetching tags:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, [user]);

  const createTag = async (name: string, color: string = "#6366f1") => {
    if (!user) {
      toast.error("Please sign in to create tags");
      return null;
    }

    try {
      const { data, error } = await supabase
        .from("tags")
        .insert({ user_id: user.id, name, color })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          toast.error("A tag with this name already exists");
        } else {
          throw error;
        }
        return null;
      }

      await fetchTags();
      return data;
    } catch (error) {
      console.error("Error creating tag:", error);
      toast.error("Failed to create tag");
      return null;
    }
  };

  const deleteTag = async (tagId: string) => {
    try {
      const { error } = await supabase
        .from("tags")
        .delete()
        .eq("id", tagId);

      if (error) throw error;
      setTags((prev) => prev.filter((tag) => tag.id !== tagId));
      toast.success("Tag deleted");
    } catch (error) {
      console.error("Error deleting tag:", error);
      toast.error("Failed to delete tag");
    }
  };

  const updateTag = async (tagId: string, updates: { name?: string; color?: string }) => {
    try {
      const { error } = await supabase
        .from("tags")
        .update(updates)
        .eq("id", tagId);

      if (error) throw error;
      await fetchTags();
      toast.success("Tag updated");
    } catch (error) {
      console.error("Error updating tag:", error);
      toast.error("Failed to update tag");
    }
  };

  return {
    tags,
    loading,
    createTag,
    deleteTag,
    updateTag,
    refetch: fetchTags,
  };
};
