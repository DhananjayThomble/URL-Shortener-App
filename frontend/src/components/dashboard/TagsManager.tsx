import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTags, Tag } from "@/hooks/useTags";
import { Plus, Trash2, Loader2, Tag as TagIcon, Palette } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const TAG_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
];

export const TagsManager = () => {
  const { tags, loading, createTag, deleteTag, updateTag } = useTags();
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleCreateTag = async () => {
    if (!newTagName.trim()) {
      toast.error("Please enter a tag name");
      return;
    }

    setCreating(true);
    const result = await createTag(newTagName.trim(), newTagColor);
    setCreating(false);

    if (result) {
      setNewTagName("");
      setNewTagColor(TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]);
      setIsDialogOpen(false);
      toast.success("Tag created!");
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl glass gradient-border p-6">
        <div className="flex items-center justify-center h-24">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl glass gradient-border p-6"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tags</h2>
          <p className="text-sm text-muted-foreground">Organize your links with tags</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              New Tag
            </Button>
          </DialogTrigger>
          <DialogContent className="glass">
            <DialogHeader>
              <DialogTitle>Create New Tag</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Tag Name</label>
                <Input
                  placeholder="e.g., Marketing"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  variant="glow"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Color</label>
                <div className="flex flex-wrap gap-2">
                  {TAG_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewTagColor(color)}
                      className={`w-8 h-8 rounded-full transition-transform ${
                        newTagColor === color ? "ring-2 ring-white ring-offset-2 ring-offset-background scale-110" : ""
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg glass">
                <span className="text-sm text-muted-foreground">Preview:</span>
                <span
                  className="px-3 py-1 rounded-full text-sm font-medium text-white"
                  style={{ backgroundColor: newTagColor }}
                >
                  {newTagName || "Tag Name"}
                </span>
              </div>
              <Button 
                variant="hero" 
                className="w-full" 
                onClick={handleCreateTag}
                disabled={creating}
              >
                {creating ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    Create Tag
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {tags.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <TagIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No tags yet. Create your first tag!</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <motion.div
              key={tag.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="group flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
              <button
                onClick={() => deleteTag(tag.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-200"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
