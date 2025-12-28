import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBioPage } from "@/hooks/useBioPage";
import { 
  Plus, Trash2, GripVertical, ExternalLink, Loader2, 
  Link2, User, Palette, Eye, Save
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const BioPageEditor = () => {
  const { 
    bioPage, 
    bioLinks, 
    loading, 
    createBioPage, 
    updateBioPage, 
    addBioLink, 
    deleteBioLink,
    updateBioLink
  } = useBioPage();

  const [username, setUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  // Editing states
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const [tempBio, setTempBio] = useState("");

  const handleCreateBioPage = async () => {
    if (!username.trim()) {
      toast.error("Please enter a username");
      return;
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      toast.error("Username can only contain letters, numbers, underscores, and hyphens");
      return;
    }

    setCreating(true);
    await createBioPage(username.toLowerCase());
    setCreating(false);
  };

  const handleAddLink = async () => {
    if (!newLinkTitle.trim() || !newLinkUrl.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      new URL(newLinkUrl);
    } catch {
      toast.error("Please enter a valid URL");
      return;
    }

    setAddingLink(true);
    await addBioLink(newLinkTitle, newLinkUrl);
    setNewLinkTitle("");
    setNewLinkUrl("");
    setIsAddDialogOpen(false);
    setAddingLink(false);
  };

  const handleSaveTitle = async () => {
    await updateBioPage({ title: tempTitle });
    setEditingTitle(false);
  };

  const handleSaveBio = async () => {
    await updateBioPage({ bio: tempBio });
    setEditingBio(false);
  };

  if (loading) {
    return (
      <div className="rounded-2xl glass gradient-border p-6">
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!bioPage) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl glass gradient-border p-6"
      >
        <div className="text-center py-8">
          <User className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Create Your Bio Page</h2>
          <p className="text-muted-foreground mb-6">
            Get a personalized link page like snap.url/@yourname
          </p>
          
          <div className="max-w-xs mx-auto space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">snap.url/@</span>
              <Input
                type="text"
                placeholder="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                variant="glow"
                className="font-mono"
              />
            </div>
            <Button 
              variant="hero" 
              onClick={handleCreateBioPage} 
              disabled={creating}
              className="w-full"
            >
              {creating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Plus className="w-5 h-5" />
                  Create Bio Page
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.div>
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
          <h2 className="text-xl font-semibold text-foreground">Bio Page</h2>
          <p className="text-sm text-muted-foreground font-mono">
            snap.url/@{bioPage.username}
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.open(`/@${bioPage.username}`, "_blank")}
          >
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </Button>
        </div>
      </div>

      {/* Profile Settings */}
      <div className="space-y-4 mb-6 pb-6 border-b border-border">
        <div>
          <label className="text-sm text-muted-foreground mb-2 block">Title</label>
          {editingTitle ? (
            <div className="flex gap-2">
              <Input
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                variant="glass"
                placeholder="Your Name"
              />
              <Button size="sm" onClick={handleSaveTitle}>
                <Save className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                setTempTitle(bioPage.title || "");
                setEditingTitle(true);
              }}
              className="w-full text-left p-3 rounded-lg glass hover:bg-surface-elevated/50 transition-colors"
            >
              {bioPage.title || <span className="text-muted-foreground">Add a title...</span>}
            </button>
          )}
        </div>

        <div>
          <label className="text-sm text-muted-foreground mb-2 block">Bio</label>
          {editingBio ? (
            <div className="flex gap-2">
              <Input
                value={tempBio}
                onChange={(e) => setTempBio(e.target.value)}
                variant="glass"
                placeholder="Tell people about yourself..."
              />
              <Button size="sm" onClick={handleSaveBio}>
                <Save className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                setTempBio(bioPage.bio || "");
                setEditingBio(true);
              }}
              className="w-full text-left p-3 rounded-lg glass hover:bg-surface-elevated/50 transition-colors"
            >
              {bioPage.bio || <span className="text-muted-foreground">Add a bio...</span>}
            </button>
          )}
        </div>
      </div>

      {/* Links */}
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground">Links</h3>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Link
              </Button>
            </DialogTrigger>
            <DialogContent className="glass">
              <DialogHeader>
                <DialogTitle>Add New Link</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Title</label>
                  <Input
                    placeholder="My Website"
                    value={newLinkTitle}
                    onChange={(e) => setNewLinkTitle(e.target.value)}
                    variant="glow"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">URL</label>
                  <Input
                    type="url"
                    placeholder="https://example.com"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    variant="glow"
                  />
                </div>
                <Button 
                  variant="hero" 
                  className="w-full" 
                  onClick={handleAddLink}
                  disabled={addingLink}
                >
                  {addingLink ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-5 h-5" />
                      Add Link
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {bioLinks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Link2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No links yet. Add your first link!</p>
          </div>
        ) : (
          bioLinks.map((link, index) => (
            <motion.div
              key={link.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex items-center gap-3 p-3 rounded-lg glass hover:bg-surface-elevated/50 transition-colors group"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{link.title}</p>
                <p className="text-sm text-muted-foreground truncate">{link.url}</p>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" asChild>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => deleteBioLink(link.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  );
};
