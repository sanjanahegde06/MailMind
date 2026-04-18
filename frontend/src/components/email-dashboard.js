"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const INITIAL_PAGE_SIZE = 12;
const NEXT_PAGE_SIZE = 25;
const NEW_EMAIL_POLL_MS = 60000;

const inboxCache = {
  hasLoaded: false,
  emails: [],
  lastTopEmailId: "",
  updatedAt: 0,
};

export default function EmailDashboard() {
  const [emails, setEmails] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [error, setError] = useState(null);
  const isRefreshingRef = useRef(false);

  const refreshInbox = useCallback(async ({ showInitialLoader = false } = {}) => {
    if (isRefreshingRef.current) {
      return;
    }

    isRefreshingRef.current = true;

    try {
      setError(null);

      if (showInitialLoader) {
        setIsLoading(true);
      }

      setIsLoadingMore(false);

      let pageToken = "";
      let pageSize = INITIAL_PAGE_SIZE;
      let hasRenderedFirstBatch = false;
      const collected = [];

      while (true) {
        const query = new URLSearchParams({ maxResults: String(pageSize) });
        if (pageToken) {
          query.set("pageToken", pageToken);
        }

        const res = await fetch(`/api/emails?${query.toString()}`, { cache: "no-store" });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to fetch emails");
        }

        const data = await res.json();
        const fetchedEmails = data.emails || [];
        collected.push(...fetchedEmails);

        setEmails([...collected]);

        if (!hasRenderedFirstBatch) {
          hasRenderedFirstBatch = true;
          setIsLoading(false);
        }

        pageToken = data.nextPageToken || "";
        if (!pageToken) {
          break;
        }

        pageSize = NEXT_PAGE_SIZE;
        setIsLoadingMore(true);

        // Let React paint current results before requesting next batch.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const now = Date.now();
      inboxCache.hasLoaded = true;
      inboxCache.emails = collected;
      inboxCache.lastTopEmailId = collected[0]?.id || "";
      inboxCache.updatedAt = now;
      setLastUpdatedAt(now);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      isRefreshingRef.current = false;
    }
  }, []);

  const checkForNewEmail = useCallback(async () => {
    if (!inboxCache.hasLoaded || isRefreshingRef.current) {
      return;
    }

    try {
      setIsCheckingUpdates(true);
      const res = await fetch("/api/emails?maxResults=1", { cache: "no-store" });

      if (!res.ok) {
        return;
      }

      const data = await res.json();
      const latestId = data.emails?.[0]?.id || "";

      if (!latestId) {
        return;
      }

      const knownTopId = inboxCache.lastTopEmailId || inboxCache.emails[0]?.id || "";

      if (knownTopId && latestId !== knownTopId) {
        await refreshInbox();
      }
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [refreshInbox]);

  useEffect(() => {
    if (inboxCache.hasLoaded) {
      setEmails(inboxCache.emails);
      setLastUpdatedAt(inboxCache.updatedAt);
      setIsLoading(false);
      return;
    }

    refreshInbox({ showInitialLoader: true });
  }, [refreshInbox]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      checkForNewEmail();
    }, NEW_EMAIL_POLL_MS);

    return () => clearInterval(intervalId);
  }, [checkForNewEmail]);

  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--";

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 rounded-3xl border border-cyan-300/25 bg-gradient-to-r from-blue-700/80 via-blue-600/70 to-cyan-500/70 p-8 text-white shadow-[0_18px_55px_rgba(13,148,255,0.25)]">
        <h1 className="text-3xl font-semibold">Inbox</h1>
        <p className="mt-2 text-blue-50/90">Click any email row to read its full content.</p>
        <p className="mt-1 text-xs text-blue-100/90">
          Last updated: {lastUpdatedLabel}
          {isCheckingUpdates ? " • Checking for new emails..." : ""}
        </p>
      </div>

      {isLoading && (
        <div className="rounded-2xl border border-blue-400/25 bg-slate-900/80 p-6 text-slate-200 shadow-sm backdrop-blur">
          Loading your emails...
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 p-6 text-rose-200 shadow-sm">{error}</div>
      )}

      {!isLoading && !error && emails.length === 0 && (
        <div className="rounded-2xl border border-blue-400/25 bg-slate-900/80 p-6 text-slate-300 shadow-sm backdrop-blur">
          No emails found.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-blue-400/20 bg-slate-900/70 shadow-xl backdrop-blur">
        {emails.map((email) => (
          <Link
            key={email.id}
            href={`/dashboard/email/${email.id}`}
            className="block w-full border-b border-blue-400/15 bg-transparent px-5 py-4 text-left transition hover:bg-blue-500/10"
          >
            <div className="mb-1 flex items-start justify-between gap-4">
              <h2 className="line-clamp-1 text-base font-semibold text-slate-100">{email.subject}</h2>
              <span className="shrink-0 text-xs text-slate-400">{email.date || ""}</span>
            </div>
            <p className="line-clamp-1 text-sm text-cyan-200/90">{email.from || "Unknown sender"}</p>
            <p className="mt-1 line-clamp-1 text-sm text-slate-300">{email.snippet}</p>
          </Link>
        ))}
      </div>

      {isLoadingMore && !error && (
        <div className="mt-4 rounded-2xl border border-blue-400/25 bg-slate-900/80 p-4 text-sm text-slate-300 shadow-sm backdrop-blur">
          Loading more emails...
        </div>
      )}
    </section>
  );
}
