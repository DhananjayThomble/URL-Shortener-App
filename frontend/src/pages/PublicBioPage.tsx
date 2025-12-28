import { useParams } from "react-router-dom";
import { usePublicBioPage } from "@/hooks/useBioPage";
import { Loader2, ExternalLink, Link2 } from "lucide-react";
import { motion } from "framer-motion";

const PublicBioPage = () => {
  const { username } = useParams<{ username: string }>();
  const { bioPage, bioLinks, loading, notFound } = usePublicBioPage(username || "");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !bioPage) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Link2 className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Page Not Found</h1>
          <p className="text-muted-foreground">This bio page doesn't exist or is private.</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen py-12 px-4"
      style={{ backgroundColor: bioPage.background_color }}
    >
      <div className="max-w-md mx-auto">
        {/* Profile Header */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          {bioPage.avatar_url ? (
            <img
              src={bioPage.avatar_url}
              alt={bioPage.title || bioPage.username}
              className="w-24 h-24 rounded-full mx-auto mb-4 object-cover border-4 border-white/10"
            />
          ) : (
            <div 
              className="w-24 h-24 rounded-full mx-auto mb-4 bg-gradient-to-br from-primary to-glow-secondary flex items-center justify-center text-3xl font-bold text-white"
            >
              {bioPage.username.charAt(0).toUpperCase()}
            </div>
          )}
          
          <h1 
            className="text-2xl font-bold mb-2"
            style={{ color: bioPage.text_color }}
          >
            {bioPage.title || `@${bioPage.username}`}
          </h1>
          
          {bioPage.bio && (
            <p 
              className="text-sm opacity-80"
              style={{ color: bioPage.text_color }}
            >
              {bioPage.bio}
            </p>
          )}
        </motion.div>

        {/* Links */}
        <div className="space-y-3">
          {bioLinks.map((link, index) => (
            <motion.a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`
                block w-full p-4 text-center font-medium transition-all hover:scale-105
                ${bioPage.button_style === 'rounded' ? 'rounded-full' : 
                  bioPage.button_style === 'square' ? 'rounded-none' : 'rounded-xl'}
              `}
              style={{
                backgroundColor: `${bioPage.text_color}15`,
                color: bioPage.text_color,
                border: `1px solid ${bioPage.text_color}30`,
              }}
            >
              <span className="flex items-center justify-center gap-2">
                {link.title}
                <ExternalLink className="w-4 h-4 opacity-50" />
              </span>
            </motion.a>
          ))}
        </div>

        {/* Footer */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 text-center"
        >
          <a 
            href="/"
            className="text-xs opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: bioPage.text_color }}
          >
            Made with SnapURL
          </a>
        </motion.div>
      </div>
    </div>
  );
};

export default PublicBioPage;
