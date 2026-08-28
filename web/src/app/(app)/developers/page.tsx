"use client";

import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Skeleton, Table, TableWrap, Tabs, Td, Th } from "@/components/ui";
import {
  useApiKeys,
  useCreateApiKey,
  useCreateWebhook,
  useDeleteWebhook,
  useRevokeApiKey,
  useWebhooks,
} from "@/lib/api/hooks";
import { API_SCOPES, WEBHOOK_EVENTS } from "@snapurl/contract";
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

  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();

  const [namingKey, setNamingKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<string[]>(["links:read", "links:write"]);
  /* Shown once and never again — the server stores a hash, so if this is
     dismissed without copying, the key is gone and a new one is the only
     recourse. That is why it gets a panel rather than a toast. */
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const [addingHook, setAddingHook] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>(["link.created"]);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const [problem, setProblem] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [confirmHook, setConfirmHook] = useState<string | null>(null);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  async function mintKey() {
    if (!keyName.trim() || keyScopes.length === 0) {
      setProblem("A key needs a name and at least one scope.");
      return;
    }
    try {
      const created = await createKey.mutateAsync({
        name: keyName.trim(),
        scopes: keyScopes as (typeof API_SCOPES)[number][],
      });
      setFreshKey(created.key);
      setKeyName("");
      setNamingKey(false);
      setProblem(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  async function addWebhook() {
    if (hookEvents.length === 0) {
      setProblem("Pick at least one event to send.");
      return;
    }
    try {
      const created = await createWebhook.mutateAsync({
        endpoint: endpoint.trim(),
        events: hookEvents as (typeof WEBHOOK_EVENTS)[number][],
      });
      setFreshSecret(created.secret);
      setEndpoint("");
      setAddingHook(false);
      setProblem(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  return (
    <>
      <PageHead
        title="Developers"
        sub="Scoped API keys, real-time webhooks, and an MCP server so agents can create links directly."
        actions={
          <>
            <Button>Read the docs</Button>
            <Button variant="primary" onClick={() => { setNamingKey((v) => !v); setProblem(null); }}>
              {namingKey ? "Cancel" : "＋ New API key"}
            </Button>
          </>
        }
      />

      {problem ? (
        <Card className="mb-3.5 border-bad">
          <CardBody className="text-[13px] text-bad">{problem}</CardBody>
        </Card>
      ) : null}

      {freshKey ? (
        <Card className="mb-3.5 border-accent">
          <CardHeader title="Copy this key now" right={<Button size="sm" onClick={() => setFreshKey(null)}>Done</Button>} />
          <CardBody className="flex flex-col gap-2">
            <code className="font-mono text-[12.5px] break-all bg-surface-3 px-3 py-2 rounded-[var(--radius-sm)]">
              {freshKey}
            </code>
            <span className="text-[12px] text-ink-3">
              This is the only time it is shown. Only a hash is stored, so it cannot be recovered — if you lose it,
              revoke this key and mint another.
            </span>
          </CardBody>
        </Card>
      ) : null}

      {freshSecret ? (
        <Card className="mb-3.5 border-accent">
          <CardHeader title="Webhook signing secret" right={<Button size="sm" onClick={() => setFreshSecret(null)}>Done</Button>} />
          <CardBody className="flex flex-col gap-2">
            <code className="font-mono text-[12.5px] break-all bg-surface-3 px-3 py-2 rounded-[var(--radius-sm)]">
              {freshSecret}
            </code>
            <span className="text-[12px] text-ink-3">
              Verify every delivery against this. The signature is HMAC-SHA256 over
              <code className="font-mono"> timestamp.body</code>, sent as X-SnapURL-Signature.
            </span>
          </CardBody>
        </Card>
      ) : null}

      {namingKey ? (
        <Card className="mb-3.5">
          <CardHeader title="New API key" />
          <CardBody className="flex flex-col gap-3">
            <Field label="Name" help="What is it for? This is how you will recognise it when revoking.">
              <Input
                value={keyName}
                autoFocus
                placeholder="CI deploy bot"
                onChange={(e) => { setKeyName(e.target.value); setProblem(null); }}
              />
            </Field>
            <Field label="Scopes" help="A key can do exactly what you tick here and nothing else.">
              <div className="flex gap-1.5 flex-wrap">
                {API_SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setKeyScopes((cur) => toggle(cur, scope))}
                    className={`px-[9px] py-[4px] rounded-[var(--radius-sm)] border text-[12px] font-mono ${
                      keyScopes.includes(scope) ? "border-accent text-accent bg-accent-wash" : "border-line text-ink-3"
                    }`}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" onClick={mintKey} disabled={createKey.isPending}>
                {createKey.isPending ? "Creating…" : "Create key"}
              </Button>
              <Button onClick={() => { setNamingKey(false); setProblem(null); }}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {addingHook ? (
        <Card className="mb-3.5">
          <CardHeader title="Add a webhook endpoint" />
          <CardBody className="flex flex-col gap-3">
            <Field label="Endpoint" help="Absolute https URL. We retry with backoff for about twelve hours.">
              <Input
                value={endpoint}
                autoFocus
                placeholder="https://example.com/hooks/snapurl"
                className="font-mono text-[12.5px]"
                onChange={(e) => { setEndpoint(e.target.value); setProblem(null); }}
              />
            </Field>
            <Field label="Events">
              <div className="flex gap-1.5 flex-wrap">
                {WEBHOOK_EVENTS.map((event) => (
                  <button
                    key={event}
                    type="button"
                    onClick={() => setHookEvents((cur) => toggle(cur, event))}
                    className={`px-[9px] py-[4px] rounded-[var(--radius-sm)] border text-[12px] font-mono ${
                      hookEvents.includes(event) ? "border-accent text-accent bg-accent-wash" : "border-line text-ink-3"
                    }`}
                  >
                    {event}
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" onClick={addWebhook} disabled={createWebhook.isPending || !endpoint.trim()}>
                {createWebhook.isPending ? "Adding…" : "Add endpoint"}
              </Button>
              <Button onClick={() => { setAddingHook(false); setProblem(null); }}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

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
                        <Td className="text-right whitespace-nowrap">
                          {confirmKey === k.id ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmKey(null)}>
                                Keep
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={revokeKey.isPending}
                                onClick={async () => {
                                  try {
                                    await revokeKey.mutateAsync(k.id);
                                  } catch (err) {
                                    setProblem((err as Error).message);
                                  }
                                  setConfirmKey(null);
                                }}
                              >
                                Revoke now
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => { setConfirmKey(k.id); setProblem(null); }}>
                              Revoke
                            </Button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Webhooks"
              right={
                <Button size="sm" onClick={() => { setAddingHook((v) => !v); setProblem(null); }}>
                  {addingHook ? "Cancel" : "＋ Add endpoint"}
                </Button>
              }
            />
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Endpoint</Th>
                    <Th>Events</Th>
                    <Th>Status</Th>
                    <Th />
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
                      <Td className="text-right whitespace-nowrap">
                        {confirmHook === w.id ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmHook(null)}>
                              Keep
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={deleteWebhook.isPending}
                              onClick={async () => {
                                try {
                                  await deleteWebhook.mutateAsync(w.id);
                                } catch (err) {
                                  setProblem((err as Error).message);
                                }
                                setConfirmHook(null);
                              }}
                            >
                              Delete
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => { setConfirmHook(w.id); setProblem(null); }}>
                            Delete
                          </Button>
                        )}
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
