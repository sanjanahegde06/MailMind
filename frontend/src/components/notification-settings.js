"use client";

import { useEffect, useState } from "react";
import { fetchPushStatus, isPushSupported, subscribeForPush, unsubscribeFromPush } from "@/lib/push-client";

export default function NotificationSettings() {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState("default");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!isPushSupported()) {
      setSupported(false);
      return;
    }

    setPermission(Notification.permission);
    fetchPushStatus().then((status) => {
      setEnabled(Boolean(status?.enabled));
    });
  }, []);

  const handleToggle = async () => {
    if (!supported) return;
    setBusy(true);
    setMessage("");

    try {
      if (enabled) {
        await unsubscribeFromPush();
        setEnabled(false);
        setMessage("Notifications are disabled for this device.");
        setBusy(false);
        return;
      }

      if (Notification.permission === "denied") {
        setPermission("denied");
        setMessage("Notifications are blocked in your browser settings.");
        setBusy(false);
        return;
      }

      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== "granted") {
        setMessage("Allow notifications to enable reminders.");
        setBusy(false);
        return;
      }

      await subscribeForPush();
      setEnabled(true);
      setMessage("Notifications enabled. You will receive alerts even when the app is closed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-cyan-200/20 bg-slate-900/70 p-5 shadow-lg sm:rounded-3xl sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Notifications</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-100">Enable device alerts</h2>
          <p className="mt-2 text-sm text-slate-300">
            Receive important email and task reminder notifications even when MailMind is closed.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy || !supported}
          className={`mt-3 inline-flex items-center justify-center rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition sm:mt-0 sm:text-sm ${
            !supported
              ? "cursor-not-allowed border-slate-600/40 text-slate-400"
              : enabled
                ? "border-emerald-300/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
                : "border-cyan-300/50 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
          }`}
        >
          {busy ? "Working..." : enabled ? "Enabled" : "Enable"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span className="rounded-full border border-blue-300/30 bg-blue-500/10 px-3 py-1">
          Permission: {permission}
        </span>
        <span className="rounded-full border border-blue-300/30 bg-blue-500/10 px-3 py-1">
          Status: {enabled ? "On" : "Off"}
        </span>
      </div>

      {message ? (
        <div className="mt-4 rounded-xl border border-cyan-200/20 bg-slate-950/70 px-4 py-3 text-xs text-slate-200 sm:text-sm">
          {message}
        </div>
      ) : null}

      {!supported ? (
        <p className="mt-3 text-xs text-rose-200">
          Push notifications are not supported in this browser.
        </p>
      ) : null}
    </div>
  );
}
