import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Link2, Zap, Settings2, Copy, Check, ExternalLink, Trash2, Loader2, 
  QrCode, X, Search
} from "lucide-react";
import { toast } from "sonner";
import { useLinks, LinkWithClicks } from "@/hooks/useURLs";
import { useTags } from "@/hooks/useTags";
import { formatDistanceToNow } from "date-fns";
import { QRCodeGenerator } from "@/components/QRCodeGenerator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const LinkShortener = () => {
  const [url, setUrl] = useState("");
  const [customAlias, setCustomAlias] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);
  
  // Tags
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  
  const { createLink } = useLinks();
  const { tags } = useTags();

  const handleShorten = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      toast.error("Please enter a URL");
      return;
    }

    try {
      new URL(url);
    } catch {
      toast.error("Please enter a valid URL");
      return;
    }

    setCreating(true);
    const result = await createLink({
      originalUrl: url,
      customAlias: customAlias || undefined,
      tagIds: selectedTags,
    });
    setCreating(false);

    if (result) {
      toast.success("Link created successfully!");
      setUrl("");
      setCustomAlias("");
      setSelectedTags([]);
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev => 
      prev.includes(tagId) 
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl glass gradient-border p-6"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Create New Link</h2>
          <p className="text-sm text-muted-foreground">Shorten and track your URLs</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-muted-foreground"
        >
          <Settings2 className="w-4 h-4 mr-2" />
          {showAdvanced ? "Hide" : "Show"} Options
        </Button>
      </div>

      <form onSubmit={handleShorten} className="space-y-4">
        <div className="relative">
          <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            type="url"
            placeholder="Paste your long URL here..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            variant="glow"
            inputSize="lg"
            className="pl-12 font-mono"
          />
        </div>

        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 pt-4 border-t border-border"
            >
              {/* Custom Alias */}
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Custom Alias</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">snap.url/</span>
                  <Input
                    type="text"
                    placeholder="my-custom-alias"
                    value={customAlias}
                    onChange={(e) => setCustomAlias(e.target.value)}
                    variant="glow"
                    className="font-mono"
                  />
                </div>
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Tags</label>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          selectedTags.includes(tag.id)
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}
                        style={{ 
                          backgroundColor: selectedTags.includes(tag.id) ? tag.color : undefined 
                        }}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <Button type="submit" variant="hero" size="lg" className="w-full" disabled={creating}>
          {creating ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <Zap className="w-5 h-5" />
              Create Short Link
            </>
          )}
        </Button>
      </form>
    </motion.div>
  );
};

// Recent Links Component
interface LinkItemProps {
  link: LinkWithClicks;
  onDelete: (id: string) => void;
  onShowQR: (link: LinkWithClicks) => void;
}

const LinkItem = ({ link, onDelete, onShowQR }: LinkItemProps) => {
  const [copied, setCopied] = useState(false);
  const shortUrl = `snap.url/${link.custom_alias || link.short_code}`;
  const fullUrl = `${window.location.origin}/r/${link.custom_alias || link.short_code}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    toast.success("Link copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-xl glass hover:bg-surface-elevated/50 transition-colors group">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0">
          <Link2 className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-mono text-foreground font-medium truncate">{shortUrl}</p>
          </div>
          <p className="text-sm text-muted-foreground truncate">{link.original_url}</p>
        </div>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-foreground">{link.clicks_count} clicks</p>
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(link.created_at), { addSuffix: true })}
          </p>
        </div>
        
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" onClick={handleCopy}>
            {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onShowQR(link)}>
            <QrCode className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <a href={link.original_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4" />
            </a>
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => onDelete(link.id)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export const RecentLinks = () => {
  const { links, loading, deleteLink } = useLinks();
  const [qrLink, setQrLink] = useState<LinkWithClicks | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredLinks, setFilteredLinks] = useState<LinkWithClicks[]>([]);

  // Filter links based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredLinks(links);
    } else {
      const filtered = links.filter(link => 
        link.original_url.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (link.custom_alias && link.custom_alias.toLowerCase().includes(searchQuery.toLowerCase())) ||
        link.short_code.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredLinks(filtered);
    }
  }, [links, searchQuery]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const clearSearch = () => {
    setSearchQuery("");
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl glass gradient-border p-6"
      >
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl glass gradient-border p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Recent Links</h2>
            <p className="text-sm text-muted-foreground">Your latest shortened URLs</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search links..."
            value={searchQuery}
            onChange={handleSearch}
            variant="glass"
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="space-y-2">
          {filteredLinks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Link2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              {searchQuery ? (
                <p>No links found matching "{searchQuery}"</p>
              ) : (
                <p>No links yet. Create your first one!</p>
              )}
            </div>
          ) : (
            <>
              {filteredLinks.slice(0, 10).map((link) => (
                <LinkItem 
                  key={link.id} 
                  link={link} 
                  onDelete={deleteLink} 
                  onShowQR={setQrLink}
                />
              ))}
              {filteredLinks.length > 10 && (
                <div className="text-center pt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing 10 of {filteredLinks.length} links
                  </p>
                  <Button variant="ghost" size="sm" className="mt-2">
                    View All Links
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>

      {/* QR Code Dialog */}
      <Dialog open={!!qrLink} onOpenChange={() => setQrLink(null)}>
        <DialogContent className="glass">
          <DialogHeader>
            <DialogTitle>QR Code</DialogTitle>
          </DialogHeader>
          {qrLink && (
            <div className="flex flex-col items-center py-4">
              <p className="text-sm text-muted-foreground mb-4 font-mono">
                {window.location.origin}/r/{qrLink.custom_alias || qrLink.short_code}
              </p>
              <QRCodeGenerator 
                url={`${window.location.origin}/r/${qrLink.custom_alias || qrLink.short_code}`} 
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
