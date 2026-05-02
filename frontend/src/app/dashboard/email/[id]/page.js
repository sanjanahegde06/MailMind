"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const summaryCache = new Map();

function SummarySection({ title, children }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-slate-900/80 p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/90">{title}</h2>
      <div className="mt-3 text-sm leading-7 text-slate-200">{children}</div>
    </section>
  );
}

function priorityClasses(priority) {
  if (priority === "High") {
    return "border-rose-300/30 bg-rose-500/15 text-rose-100";
  }

  if (priority === "Medium") {
    return "border-amber-300/30 bg-amber-500/15 text-amber-100";
  }

  return "border-emerald-300/30 bg-emerald-500/15 text-emerald-100";
}

function formatSummaryText(value) {
  if (!value) {
    return "";
  }

  return value;
}

export default function EmailDetailPage() {
  const params = useParams();
  const rawId = params.id;
  const emailId = Array.isArray(rawId) ? rawId[0] : String(rawId || "");
  const [email, setEmail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSummaryDrawerOpen, setIsSummaryDrawerOpen] = useState(false);
  const [summaryState, setSummaryState] = useState({
    status: "idle",
    summary: null,
    source: null,
    error: "",
  });

  const emailViewerStyles = `
    :root { color-scheme: dark; }
    html, body {
      margin: 0;
      padding: 0;
      background: #020b24 !important;
      color: #dbeafe;
      font-family: "Segoe UI", "Noto Sans", sans-serif;
      line-height: 1.65;
    }
    body {
      padding: 18px;
    }
    body[bgcolor], table[bgcolor], td[bgcolor], div[bgcolor] {
      background: transparent !important;
    }
    img, video, table, iframe {
      max-width: 100% !important;
    }
    a {
      color: #7dd3fc;
    }
    pre, code {
      white-space: pre-wrap;
      word-break: break-word;
    }
  `;

  const emailHtmlDocument = email?.bodyHtml
    ? `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><base target="_blank" /><style>${emailViewerStyles}</style></head><body>${email.bodyHtml}</body></html>`
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

  useEffect(() => {
    if (!isSummaryDrawerOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsSummaryDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSummaryDrawerOpen]);

  async function loadSummary() {
    if (!email) {
      return;
    }

    setIsSummaryDrawerOpen(true);

    const cachedSummary = summaryCache.get(email.id);
    if (cachedSummary) {
      setSummaryState({
        status: "ready",
        summary: cachedSummary.summary,
        source: cachedSummary.source,
        error: "",
      });
      return;
    }

    setSummaryState({
      status: "loading",
      summary: null,
      source: null,
      error: "",
    });

    try {
      const response = await fetch(`/api/emails/${encodeURIComponent(email.id)}/summary`, {
        method: "POST",
        cache: "no-store",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to generate summary");
      }

      const data = await response.json();
      const nextSummary = data?.summary || null;
      const source = data?.source || "unknown";

      if (!nextSummary) {
        setSummaryState({
          status: "empty",
          summary: null,
          source: null,
          error: "",
        });
        return;
      }

      summaryCache.set(email.id, { summary: nextSummary, source });
      setSummaryState({
        status: "ready",
        summary: nextSummary,
        source,
        error: "",
      });
    } catch (err) {
      setSummaryState({
        status: "error",
        summary: null,
        source: null,
        error: err instanceof Error ? err.message : "Failed to generate summary",
      });
    }
  }

  const summary = summaryState.summary;

  return (
    <>
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
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-white">{email.subject}</h1>
                <p className="mt-2 text-sm text-cyan-200">{email.from}</p>
                {email.date && <p className="text-xs text-slate-400">{email.date}</p>}
              </div>

              <button
                type="button"
                onClick={loadSummary}
                className="inline-flex shrink-0 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
              >
                Summarize
              </button>
            </div>

            <hr className="my-5 border-blue-400/20" />

            {email.bodyHtml ? (
              <iframe
                title="Email content"
                srcDoc={emailHtmlDocument}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className="h-[72vh] w-full rounded-xl border border-blue-300/20 bg-[#020b24] shadow-inner"
              />
            ) : (
              <article className="max-h-[72vh] overflow-y-auto rounded-xl border border-blue-300/20 bg-slate-950/60 p-5 text-sm leading-7 text-slate-200">
                <p className="whitespace-pre-wrap">{email.bodyText || email.body || email.snippet}</p>
              </article>
            )}
          </article>
        )}
      </section>

      <div
        className={`fixed inset-0 z-50 transition ${isSummaryDrawerOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!isSummaryDrawerOpen}
      >
        <button
          type="button"
          aria-label="Close summary drawer"
          className={`absolute inset-0 bg-slate-950/60 backdrop-blur-[1px] transition-opacity duration-300 ${isSummaryDrawerOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setIsSummaryDrawerOpen(false)}
        />

        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-summary-title"
          className={`absolute right-0 top-0 flex h-full w-full max-w-full flex-col border-l border-blue-300/20 bg-slate-950/95 shadow-[0_20px_80px_rgba(2,8,23,0.65)] transition-transform duration-300 ease-out sm:w-[38vw] sm:min-w-[360px] sm:max-w-[520px] ${isSummaryDrawerOpen ? "translate-x-0" : "translate-x-full"}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">Email Summary</p>
              <h2 id="email-summary-title" className="mt-1 text-lg font-semibold text-white">
                Email Summary
              </h2>
              {summaryState.source && summaryState.status === "ready" && (
                <p className="mt-2 text-xs text-slate-400">
                  {summaryState.source === "gemini" ? "✨ Powered by Gemini" : "Fallback Summarization"}
                </p>
              )}
            </div>

            <button
              type="button"
              aria-label="Close summary"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
              onClick={() => setIsSummaryDrawerOpen(false)}
            >
              X
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {summaryState.status === "loading" && (
              <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-white/8 bg-slate-900/70 text-slate-200">
                <div className="flex items-center gap-3 text-sm text-slate-200">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-200/30 border-t-cyan-200" />
                  Summarizing...
                </div>
              </div>
            )}

            {summaryState.status === "empty" && (
              <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-white/8 bg-slate-900/70 text-sm text-slate-300">
                No summary available
              </div>
            )}

            {summaryState.status === "error" && (
              <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-rose-300/20 bg-rose-500/10 text-sm text-rose-100">
                Failed to generate summary
              </div>
            )}

            {summaryState.status === "ready" && summary && (
              <div className="space-y-4">
                <SummarySection title="Overview">
                  <p className="whitespace-pre-line text-slate-100">{formatSummaryText(summary.overview)}</p>
                </SummarySection>

                <SummarySection title="Key Points">
                  {summary.keyPoints?.length ? (
                    <ul className="space-y-2">
                      {summary.keyPoints.map((item) => (
                        <li key={item} className="flex gap-2 text-slate-100">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-400">None mentioned</p>
                  )}
                </SummarySection>

                <SummarySection title="Deadlines">
                  {summary.deadlines?.length ? (
                    <ul className="space-y-2">
                      {summary.deadlines.map((item) => (
                        <li key={item} className="flex gap-2 text-slate-100">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-400">None mentioned</p>
                  )}
                </SummarySection>

                <SummarySection title="Action Items">
                  {summary.actionItems?.length ? (
                    <ul className="space-y-2">
                      {summary.actionItems.map((item) => (
                        <li key={item} className="flex gap-2 text-slate-100">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-400">None mentioned</p>
                  )}
                </SummarySection>

                <SummarySection title="Priority">
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${priorityClasses(summary.priority)}`}
                  >
                    {summary.priority}
                  </span>
                </SummarySection>
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
