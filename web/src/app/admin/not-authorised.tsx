import { ButtonLink, Card, CardBody } from "@/components/ui";

/* #968 — the plain "not authorised" page shown when the server refuses the
   admin area. Deliberately spare: it reveals nothing about what the admin area
   is or who can reach it, only that this account cannot, and a way back out. */
export function NotAuthorised() {
  return (
    <main className="min-h-screen grid place-items-center p-6" role="main">
      <Card className="max-w-md w-full">
        <CardBody className="space-y-4 text-center">
          <h1 className="text-lg font-semibold text-ink-1">Not authorised</h1>
          <p className="text-sm text-ink-3">
            This account doesn’t have access to the admin area.
          </p>
          <div className="pt-2">
            <ButtonLink href="/links">Back to your dashboard</ButtonLink>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
