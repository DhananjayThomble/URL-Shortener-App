"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { tokens } from "@/lib/api/client";
import { heroShortenTarget, isPlausibleHttpUrl } from "@/lib/hero-shorten";

/**
 * The marketing hero's Shorten box (#660).
 *
 * Previously the input was decorative and "Shorten" was a plain link to
 * /register that dropped whatever the visitor had pasted. Now it is a real
 * <form>: on submit we validate the URL, then route the visitor to the
 * create-link drawer carrying their URL — straight there if signed in, via
 * sign-up (with the drawer deep link as `next`) if not. Next handling itself
 * is left to safeNext/withNext on the auth pages (#668); this only builds the
 * target path (see heroShortenTarget).
 */
export function MarketingShortenForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = inputRef.current?.value ?? "";
    if (!isPlausibleHttpUrl(raw)) {
      setError("Enter a web address, like https://example.com/page");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    // Signed-in is signalled by a stored access token — the same thing the
    // dashboard route guard checks. No network round-trip on the landing page.
    const signedIn = Boolean(tokens.access);
    router.push(heroShortenTarget(raw, signedIn));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-[640px] mx-auto mt-[34px]">
      <div className="bg-surface border border-line-2 rounded-[14px] p-[9px] flex flex-col sm:flex-row gap-[9px] shadow-[var(--shadow-2)] text-left">
        <input
          ref={inputRef}
          type="url"
          name="url"
          placeholder="https://acme.com/collections/spring-2026?utm_source=instagram"
          spellCheck={false}
          onInput={() => error && setError(null)}
          aria-label="URL to shorten"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="flex-1 bg-transparent border-none px-[11px] py-[9px] text-[14.5px] text-ink focus:outline-none min-w-0"
        />
        <button
          type="submit"
          className="px-[18px] py-[9px] rounded-[var(--radius-sm)] bg-accent text-accent-ink font-semibold text-[13px] text-center whitespace-nowrap"
        >
          Shorten
        </button>
      </div>
      {/* aria-live so a screen reader announces the error the moment it appears,
          without the input losing focus. */}
      <p id={errorId} role="alert" aria-live="polite" className="min-h-[18px] mt-[7px] px-[11px] text-[12.5px] text-bad">
        {error}
      </p>
    </form>
  );
}
