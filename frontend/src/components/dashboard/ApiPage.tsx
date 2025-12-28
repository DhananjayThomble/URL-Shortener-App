import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code, Copy, Key, RefreshCw, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const ApiPage = () => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey] = useState("sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const endpoints = [
    {
      method: "GET",
      path: "/api/v1/links",
      description: "List all links for the authenticated user",
      params: "?page=1&limit=20",
    },
    {
      method: "POST",
      path: "/api/v1/links",
      description: "Create a new short link",
      params: "",
    },
    {
      method: "GET",
      path: "/api/v1/links/:id",
      description: "Get a specific link by ID",
      params: "",
    },
    {
      method: "PATCH",
      path: "/api/v1/links/:id",
      description: "Update a link",
      params: "",
    },
    {
      method: "DELETE",
      path: "/api/v1/links/:id",
      description: "Delete a link",
      params: "",
    },
    {
      method: "GET",
      path: "/api/v1/links/:id/stats",
      description: "Get click analytics for a link",
      params: "?from=2024-01-01&to=2024-12-31",
    },
    {
      method: "GET",
      path: "/api/v1/analytics/overview",
      description: "Get overall analytics summary",
      params: "",
    },
  ];

  const methodColors: Record<string, string> = {
    GET: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    POST: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    PATCH: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    DELETE: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <div className="max-w-4xl space-y-6">
      <Card className="glass-strong border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                API Keys
              </CardTitle>
              <CardDescription>
                Use your API key to authenticate requests
              </CardDescription>
            </div>
            <Badge variant="outline" className="gap-1">
              <AlertCircle className="w-3 h-3" />
              Coming Soon
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                readOnly
                className="pr-20 font-mono text-sm"
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-8 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => copyToClipboard(apiKey, "API Key")}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <Button variant="secondary" className="gap-2" onClick={() => toast.info("API key regeneration requires NestJS backend")}>
              <RefreshCw className="w-4 h-4" />
              Regenerate
            </Button>
          </div>
          
          <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
            Note: API functionality will be available after NestJS backend migration. See documentation for planned endpoints.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="endpoints" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
          <TabsTrigger value="examples">Code Examples</TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="mt-4">
          <Card className="glass-strong border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Available Endpoints</CardTitle>
              <CardDescription>
                REST API endpoints for programmatic access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {endpoints.map((endpoint, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <Badge className={`${methodColors[endpoint.method]} font-mono text-xs min-w-[60px] justify-center`}>
                      {endpoint.method}
                    </Badge>
                    <code className="text-sm font-mono text-foreground flex-1">
                      {endpoint.path}
                      {endpoint.params && (
                        <span className="text-muted-foreground">{endpoint.params}</span>
                      )}
                    </code>
                    <span className="text-sm text-muted-foreground hidden md:block">
                      {endpoint.description}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="examples" className="mt-4">
          <Card className="glass-strong border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Code Examples</CardTitle>
              <CardDescription>
                Quick start examples in popular languages
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* cURL Example */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">cURL</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1"
                    onClick={() => copyToClipboard(`curl -X POST https://api.snapurl.com/v1/links \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com", "title": "My Link"}'`, "cURL example")}
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </Button>
                </div>
                <pre className="p-4 rounded-lg bg-muted/50 overflow-x-auto text-sm font-mono">
{`curl -X POST https://api.snapurl.com/v1/links \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com", "title": "My Link"}'`}
                </pre>
              </div>

              {/* JavaScript Example */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">JavaScript / TypeScript</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1"
                    onClick={() => copyToClipboard(`const response = await fetch('https://api.snapurl.com/v1/links', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://example.com',
    title: 'My Link',
  }),
});

const link = await response.json();
console.log(link.short_url);`, "JavaScript example")}
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </Button>
                </div>
                <pre className="p-4 rounded-lg bg-muted/50 overflow-x-auto text-sm font-mono">
{`const response = await fetch('https://api.snapurl.com/v1/links', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://example.com',
    title: 'My Link',
  }),
});

const link = await response.json();
console.log(link.short_url);`}
                </pre>
              </div>

              {/* Python Example */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Python</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1"
                    onClick={() => copyToClipboard(`import requests

response = requests.post(
    'https://api.snapurl.com/v1/links',
    headers={
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json',
    },
    json={
        'url': 'https://example.com',
        'title': 'My Link',
    }
)

link = response.json()
print(link['short_url'])`, "Python example")}
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </Button>
                </div>
                <pre className="p-4 rounded-lg bg-muted/50 overflow-x-auto text-sm font-mono">
{`import requests

response = requests.post(
    'https://api.snapurl.com/v1/links',
    headers={
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json',
    },
    json={
        'url': 'https://example.com',
        'title': 'My Link',
    }
)

link = response.json()
print(link['short_url'])`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
