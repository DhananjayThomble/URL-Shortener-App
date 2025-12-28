import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import * as UAParser from "ua-parser-js";

interface LinkData {
  id: string;
  original_url: string;
  short_code: string;
  is_active: boolean;
  expires_at: string | null;
  ios_url: string | null;
  android_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  password_hash: string | null;
  password_hint: string | null;
}

interface GeoRule {
  country_code: string;
  redirect_url: string;
}

const RedirectPage = () => {
  const { shortCode } = useParams<{ shortCode: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [geoRules, setGeoRules] = useState<GeoRule[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const checkLink = async () => {
      if (!shortCode) {
        navigate("/");
        return;
      }

      try {
        // Fetch the link
        const { data: link, error: linkError } = await supabase
          .from("links")
          .select("*")
          .or(`short_code.eq.${shortCode},custom_alias.eq.${shortCode}`)
          .eq("is_active", true)
          .maybeSingle();

        if (linkError || !link) {
          setError("Link not found or has been deactivated");
          return;
        }

        // Check expiration
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
          setError("This link has expired");
          return;
        }

        // Fetch geo rules
        const { data: geoData } = await supabase
          .from("geo_rules")
          .select("country_code, redirect_url")
          .eq("link_id", link.id);

        setGeoRules(geoData || []);
        setLinkData(link as LinkData);

        // Check if password protected
        if (link.password_hash) {
          setRequiresPassword(true);
          return;
        }

        // No password required, proceed with redirect
        await performRedirect(link as LinkData, geoData || []);
      } catch (err) {
        console.error("Redirect error:", err);
        setError("An error occurred while processing your request");
      }
    };

    checkLink();
  }, [shortCode, navigate]);

  const performRedirect = async (link: LinkData, rules: GeoRule[]) => {
    // Parse user agent for device info
    const parser = new (UAParser as any).default();
    const result = parser.getResult();
    const device = result.device.type || "desktop";
    const browser = result.browser.name || "Unknown";
    const os = result.os.name || "Unknown";

    // Try to get user's country (using a free geo-IP service)
    let userCountry = "";
    try {
      const geoResponse = await fetch("https://ipapi.co/json/");
      if (geoResponse.ok) {
        const geoData = await geoResponse.json();
        userCountry = geoData.country_code || "";
      }
    } catch (e) {
      console.warn("Could not determine user country");
    }

    // Record the click with country
    await supabase.from("clicks").insert({
      link_id: link.id,
      device,
      browser,
      os,
      referrer: document.referrer || null,
      country: userCountry || null,
    });

    // Determine redirect URL
    let redirectUrl = link.original_url;

    // Check geo-targeting rules first
    if (userCountry && rules.length > 0) {
      const geoMatch = rules.find(
        (rule) => rule.country_code.toUpperCase() === userCountry.toUpperCase()
      );
      if (geoMatch) {
        redirectUrl = geoMatch.redirect_url;
      }
    }

    // Then check device targeting (only if no geo rule matched)
    if (redirectUrl === link.original_url) {
      if (os.toLowerCase().includes("ios") && link.ios_url) {
        redirectUrl = link.ios_url;
      } else if (os.toLowerCase().includes("android") && link.android_url) {
        redirectUrl = link.android_url;
      }
    }

    // Append UTM parameters if set
    const url = new URL(redirectUrl);
    if (link.utm_source) url.searchParams.set("utm_source", link.utm_source);
    if (link.utm_medium) url.searchParams.set("utm_medium", link.utm_medium);
    if (link.utm_campaign) url.searchParams.set("utm_campaign", link.utm_campaign);
    if (link.utm_term) url.searchParams.set("utm_term", link.utm_term);
    if (link.utm_content) url.searchParams.set("utm_content", link.utm_content);

    // Redirect
    window.location.href = url.toString();
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkData || !password.trim()) return;

    setIsSubmitting(true);
    setPasswordError("");

    try {
      // Simple password comparison (in production, use proper hashing via backend)
      // For now, we compare plain text - NestJS will handle proper bcrypt comparison
      if (password === linkData.password_hash) {
        await performRedirect(linkData, geoRules);
      } else {
        setPasswordError("Incorrect password");
      }
    } catch (err) {
      setPasswordError("An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Oops!</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (requiresPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md glass-strong border-border/50">
          <CardHeader className="text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <CardTitle>Password Protected</CardTitle>
            <CardDescription>
              This link is protected. Enter the password to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <Input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={passwordError ? "border-destructive" : ""}
                />
                {passwordError && (
                  <p className="text-sm text-destructive mt-1">{passwordError}</p>
                )}
                {linkData?.password_hint && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Hint: {linkData.password_hint}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    </div>
  );
};

export default RedirectPage;
