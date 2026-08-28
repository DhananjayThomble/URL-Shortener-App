"use client";

import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Skeleton, Table, TableWrap, Tabs, Td, Th } from "@/components/ui";
import { useApiKeys, useWebhooks } from "@/lib/api/hooks";
import { API_URL } from "@/lib/api/client";

const SNIPPETS = {
  curl: `curl -X POST ${API_URL}/links \\
  -H "Authorization: Bearer $SNAP_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "destination": "https://acme.com/spring",
    "domain": "snap.to",
    "slug": "spring-sale",
    "tags": ["campaign/spring"],
    "expiresAt": "2026-09-30T00:00:00Z",
    "rules": [
      { "when": {"country": "IN"},
        "then": "https://acme.in/spring" }
    ]
  }'`,
  ts: `import { SnapURL } from "@snapurl/sdk";

const snap = new SnapURL({ key: process.env.SNAP_KEY });

const link = await snap.links.create({
  destination: "https://acme.com/spring",
  domain: "snap.to",
  slug: "spring-sale",
  tags: ["campaign/spring"],
  expiresAt: "2026-09-30T00:00:00Z",
  rules: [
    { when: { country: "IN" },
      then: "https://acme.in/spring" },
  ],
});

console.log(link.shortUrl);`,
  python: `from snapurl import SnapURL

snap = SnapURL(key=os.environ["SNAP_KEY"])

link = snap.links.create(
    destination="https://acme.com/spring",
    domain="snap.to",
    slug="spring-sale",
    tags=["campaign/spring"],
    expires_at="2026-09-30T00:00:00Z",
    rules=[
        {"when": {"country": "IN"},
         "then": "https://acme.in/spring"},
    ],
)

print(link.short_url)`,
} as const;

export default function DevelopersPage() {
  const { data: keys, isLoading } = useApiKeys();
  const { data: hooks } = useWebhooks();
  const [lang, setLang] = useState<keyof typeof SNIPPETS>("curl");

  return (
    <>
      <PageHead
        title="Developers"
        sub="Scoped API keys, real-time webhooks, and an MCP server so agents can create links directly."
        actions={
          <>
            <Button>Read the docs</Button>
            <Button variant="primary">＋ New API key</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="API keys" />
            {isLoading ? (
              <CardBody>
                <Skeleton className="h-[160px]" />
              </CardBody>
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Key</Th>
                      <Th>Scopes</Th>
                      <Th>Last used</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {(keys ?? []).map((k) => (
                      <tr key={k.id}>
                        <Td className="text-ink font-medium">{k.name}</Td>
                        <Td className="font-mono text-[12px]">{k.maskedKey}</Td>
                        <Td>
                          <span className="flex gap-1 flex-wrap">
                            {k.scopes.map((s) => (
                              <Chip key={s}>{s}</Chip>
                            ))}
                          </span>
                        </Td>
                        <Td>{k.lastUsed ?? "Never"}</Td>
                        <Td className="text-right">
                          <Button size="sm" variant="ghost">
                            Revoke
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>

          <Card>
            <CardHeader title="Webhooks" right={<Button size="sm">＋ Add endpoint</Button>} />
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Endpoint</Th>
                    <Th>Events</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {(hooks ?? []).map((w) => (
                    <tr key={w.id}>
                      <Td className="text-ink font-medium font-mono text-[12px]">{w.endpoint}</Td>
                      <Td>
                        <span className="flex gap-1 flex-wrap">
                          {w.events.map((e) => (
                            <Chip key={e}>{e}</Chip>
                          ))}
                        </span>
                      </Td>
                      <Td>
                        <Chip tone={w.health === "healthy" ? "good" : "warn"} dot>
                          {w.detail}
                        </Chip>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Create a link"
            right={
              <Tabs
                value={lang}
                onChange={setLang}
                options={[
                  { value: "curl", label: "cURL" },
                  { value: "ts", label: "TS" },
                  { value: "python", label: "Python" },
                ]}
              />
            }
          />
          <pre className="m-0 p-4 font-mono text-[12px] leading-[1.75] overflow-x-auto text-ink-2 whitespace-pre">
            {SNIPPETS[lang]}
          </pre>
          <div className="p-4 border-t border-line flex gap-[18px] text-[11.5px] text-ink-3 flex-wrap">
            <span>
              SDKs <b className="text-ink-2">TS · Python · Go</b>
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
