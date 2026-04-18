"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function EmailDetailPage() {
  const params = useParams();
  const rawId = params.id;
  const emailId = Array.isArray(rawId) ? rawId[0] : String(rawId || "");
  const [email, setEmail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const emailHtmlDocument = email?.bodyHtml
    ? `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><base target="_blank" /></head><body>${email.bodyHtml}</body></html>`
    : "";

  useEffect(() => {
    if (!emailId) {
      return;
    }

    async function fetchEmail() {
      try {
        setIsLoading(true);
        const res = await fetch(`/api/emails/${encodeURIComponent(emailId)}`, { cache: "no-store" });

        if (!res.ok) {
          const data = await res.json();
          const detail = data?.details ? ` (${data.details})` : "";
          throw new Error(`${data.error || "Failed to fetch email"}${detail}`);
        }

        const data = await res.json();
        setEmail(data.email || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    }

    fetchEmail();
  }, [emailId]);

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-sm text-cyan-100 transition hover:bg-blue-500/20"
        >
          Back to inbox
        </Link>
      </div>

      {isLoading && (
        <div className="rounded-2xl border border-blue-400/25 bg-slate-900/80 p-6 text-slate-200 shadow-sm backdrop-blur">
          Loading email...
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 p-6 text-rose-200 shadow-sm">{error}</div>
      )}

      {!isLoading && !error && email && (
        <article className="rounded-2xl border border-blue-400/20 bg-slate-900/70 p-6 shadow-xl backdrop-blur">
          <h1 className="text-2xl font-semibold text-white">{email.subject}</h1>
          <p className="mt-2 text-sm text-cyan-200">{email.from}</p>
          {email.date && <p className="text-xs text-slate-400">{email.date}</p>}

          <hr className="my-5 border-blue-400/20" />

          {email.bodyHtml ? (
            <iframe
              title="Email content"
              srcDoc={emailHtmlDocument}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              className="h-[72vh] w-full rounded-lg border border-slate-700 bg-white"
            />
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
              {email.bodyText || email.body || email.snippet}
            </div>
          )}
        </article>
      )}
    </section>
  );
}
