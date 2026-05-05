"use client";

import EmailCard from "@/components/email-card";
import { useCallback, useEffect, useRef, useState } from "react";

const INITIAL_PAGE_SIZE = 12;
const NEXT_PAGE_SIZE = 25;
const NEW_EMAIL_POLL_MS = 60000;
const TASK_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;

const inboxCache = {
  hasLoaded: false,
  emails: [],
  lastTopEmailId: "",
  updatedAt: 0,
  lastTaskSyncAt: 0,
};

const PROMO_KEYWORDS = [
  "unsubscribe",
  "offer",
  "sale",
  "discount",
  "promo",
  "promotion",
  "newsletter",
  "limited time",
  "buy now",
  "shop now",
  "free trial",
  "deal",
  "save",
  "webinar",
  "workshop",
  "announcement",
];

function isPromotionalEmail(email) {
  const subject = String(email?.subject || "").toLowerCase();
  const snippet = String(email?.snippet || "").toLowerCase();
  const from = String(email?.from || "").toLowerCase();
  const combined = `${subject} ${snippet} ${from}`;
  const hits = PROMO_KEYWORDS.filter((keyword) => combined.includes(keyword)).length;
  return hits >= 2 || (hits >= 1 && combined.includes("unsubscribe"));
}

export default function EmailDashboard() {
  const [emails, setEmails] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [error, setError] = useState(null);
  const [processStatus, setProcessStatus] = useState("");
  const isRefreshingRef = useRef(false);
  const hasTriggeredInitialProcessRef = useRef(false);

  const processEmailsForTasks = useCallback(async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && inboxCache.lastTaskSyncAt && now - inboxCache.lastTaskSyncAt < TASK_SYNC_MIN_INTERVAL_MS) {
      setProcessStatus("Task sync is up to date.");
      return;
    }

    try {
      setProcessStatus("Syncing tasks from your latest emails...");
      const response = await fetch("/api/process-emails?maxResults=12", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        setProcessStatus("Task sync is unavailable right now.");
        return;
      }

      const result = await response.json();
      const processedNew = result.processed_new || 0;
      const skippedExisting = result.skipped_existing || 0;
      const failed = result.failed || 0;
      const rateLimited = Boolean(result.rate_limited);
      const suffix = rateLimited ? " Rate limit hit, partial results saved." : "";
      inboxCache.lastTaskSyncAt = Date.now();
      setProcessStatus(
        `Task sync: ${processedNew} new, ${skippedExisting} skipped, ${failed} failed.${suffix}`,
      );
    } catch {
      setProcessStatus("Task sync is unavailable right now.");
    }
  }, []);

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
        await processEmailsForTasks({ force: true });
      }
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [processEmailsForTasks, refreshInbox]);

  useEffect(() => {
    if (inboxCache.hasLoaded) {
      setEmails(inboxCache.emails);
      setLastUpdatedAt(inboxCache.updatedAt);
      setIsLoading(false);
      if (!hasTriggeredInitialProcessRef.current) {
        hasTriggeredInitialProcessRef.current = true;
        processEmailsForTasks();
      }
      return;
    }

    refreshInbox({ showInitialLoader: true });
  }, [processEmailsForTasks, refreshInbox]);

  useEffect(() => {
    if (!isLoading && !hasTriggeredInitialProcessRef.current) {
      hasTriggeredInitialProcessRef.current = true;
      processEmailsForTasks();
    }
  }, [isLoading, processEmailsForTasks]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      checkForNewEmail();
    }, NEW_EMAIL_POLL_MS);

    return () => clearInterval(intervalId);
  }, [checkForNewEmail]);

  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--";

  const promotionalEmails = emails.filter(isPromotionalEmail);
  const primaryEmails = emails.filter((email) => !isPromotionalEmail(email));

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 rounded-3xl border border-cyan-300/25 bg-gradient-to-r from-blue-700/85 via-sky-700/80 to-cyan-600/75 p-8 text-white shadow-[0_18px_55px_rgba(13,148,255,0.25)]">
        <h1 className="text-3xl font-semibold">Dashboard Inbox</h1>
        <p className="mt-2 text-blue-50/90">Your latest emails are listed here, and tasks are extracted automatically in the background.</p>
        <p className="mt-1 text-xs text-blue-100/90">
          Last updated: {lastUpdatedLabel}
          {isCheckingUpdates ? " • Checking for new emails..." : ""}
        </p>
        {processStatus ? <p className="mt-2 text-xs text-cyan-100/90">{processStatus}</p> : null}
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
        {primaryEmails.map((email, index) => (
          <div
            key={email.id}
            className={index === primaryEmails.length - 1 ? "" : "border-b border-blue-400/15"}
          >
            <EmailCard email={email} />
          </div>
        ))}
      </div>

      {promotionalEmails.length > 0 ? (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">Promotions</h2>
            <span className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">Auto-filtered</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-blue-400/20 bg-slate-900/60 shadow-xl backdrop-blur">
            {promotionalEmails.map((email, index) => (
              <div
                key={`promo-${email.id}`}
                className={
                  index === promotionalEmails.length - 1 ? "" : "border-b border-blue-400/15"
                }
              >
                <EmailCard email={email} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {isLoadingMore && !error && (
        <div className="mt-4 rounded-2xl border border-blue-400/25 bg-slate-900/80 p-4 text-sm text-slate-300 shadow-sm backdrop-blur">
          Loading more emails...
        </div>
      )}
    </section>
  );
}
