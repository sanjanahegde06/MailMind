"use client";

import { useEffect, useState } from "react";
import { isPushSupported, subscribeForPush } from "@/lib/push-client";

const PROMPT_KEY = "mailmind.push.prompted";

export default function PushNotificationManager() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;

    const permission = Notification.permission;
    const prompted = window.localStorage.getItem(PROMPT_KEY);

    if (permission === "default" && !prompted) {
      setShowPrompt(true);
    }
  }, []);

  const handleEnable = async () => {
    if (!isPushSupported()) {
      setStatus("error");
      setMessage("Notifications are not supported in this browser.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const permission = await Notification.requestPermission();
      window.localStorage.setItem(PROMPT_KEY, "1");

      if (permission !== "granted") {
        setStatus("denied");
        setMessage("Notifications are blocked. You can enable them in browser settings.");
        setBusy(false);
        return;
      }

      await subscribeForPush();
      setStatus("enabled");
      setMessage("Notifications enabled. You will receive alerts even when the app is closed.");
      setShowPrompt(false);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to enable notifications.");
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    window.localStorage.setItem(PROMPT_KEY, "1");
    setShowPrompt(false);
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-cyan-200/30 bg-slate-950 p-5 text-slate-100 shadow-2xl sm:rounded-3xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Stay on track</p>
        <h2 className="mt-2 text-lg font-semibold sm:text-xl">Enable MailMind notifications</h2>
        <p className="mt-2 text-sm text-slate-300">
          Get alerts for important emails and task reminders even when the app is closed.
        </p>
        {message ? (
          <div
            className={`mt-3 rounded-xl border px-3 py-2 text-xs sm:text-sm ${
              status === "enabled"
                ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-100"
                : status === "denied"
                  ? "border-amber-300/40 bg-amber-500/10 text-amber-100"
                  : "border-rose-300/40 bg-rose-500/10 text-rose-100"
            }`}
          >
            {message}
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-3">
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy}
            className={`flex-1 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition sm:text-sm ${
              busy
                ? "cursor-not-allowed border border-slate-600/40 text-slate-400"
                : "border border-cyan-300/50 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30"
            }`}
          >
            {busy ? "Enabling..." : "Enable"}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className="flex-1 rounded-xl border border-blue-300/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-blue-500/10 sm:text-sm"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
