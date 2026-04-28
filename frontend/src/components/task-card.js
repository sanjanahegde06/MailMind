"use client";

import Link from "next/link";
import { useState } from "react";

const PRIORITY_STYLES = {
  High: "border-rose-200/30 bg-rose-300/15 text-rose-100",
  Medium: "border-amber-200/30 bg-amber-300/15 text-amber-100",
  Low: "border-emerald-200/30 bg-emerald-300/15 text-emerald-100",
};

function normalizePriority(priority) {
  const raw = String(priority || "").toLowerCase();
  if (raw.startsWith("h")) return "High";
  if (raw.startsWith("l")) return "Low";
  return "Medium";
}

function isLikelyGmailId(id) {
  return /^[a-f0-9]{10,}$/i.test(String(id || "").trim());
}

export default function TaskCard({ task }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const normalized = normalizePriority(task.priority);
  const emailId = String(task.email_id || "").trim();
  const canOpenEmail = isLikelyGmailId(emailId);
  const done = Boolean(task.done);

  const handleMenuToggle = (event) => {
    event.stopPropagation();
    setMenuOpen((previous) => !previous);
  };

  const handleDelete = (event) => {
    event.stopPropagation();
    setMenuOpen(false);
    if (typeof task.onDelete === "function") {
      task.onDelete(task);
    }
  };

  const handleToggleDone = (event) => {
    event.stopPropagation();
    if (typeof task.onToggleDone === "function") {
      task.onToggleDone(task);
    }
  };

  const content = (
    <article className="relative rounded-2xl border border-blue-400/20 bg-slate-900/75 p-5 shadow-lg backdrop-blur transition hover:border-cyan-300/35 hover:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className={`text-base font-semibold ${done ? "text-slate-400 line-through" : "text-slate-100"}`}>
          {task.task || "No task title"}
        </h2>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${PRIORITY_STYLES[normalized]}`}>
            {normalized}
          </span>
          <button
            type="button"
            onClick={handleMenuToggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300/25 bg-slate-800/70 text-slate-200 hover:bg-slate-700"
            aria-label="More actions"
          >
            ...
          </button>
          {menuOpen ? (
            <div className="absolute right-4 top-14 z-10 min-w-28 rounded-lg border border-rose-300/25 bg-slate-900 p-1 shadow-xl">
              <button
                type="button"
                onClick={handleDelete}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-rose-200 hover:bg-rose-500/20"
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <p className="text-sm text-slate-300">
        Deadline: <span className="font-medium text-cyan-100">{task.deadline || "Not specified"}</span>
      </p>
      <p className="mt-3 text-xs text-cyan-200/80">
        {canOpenEmail ? (
          <Link className="underline decoration-cyan-300/50 underline-offset-2" href={`/dashboard/email/${encodeURIComponent(emailId)}`}>
            Click to open the source email
          </Link>
        ) : (
          "Source email not available"
        )}
      </p>

      <div className="mt-4">
        <button
          type="button"
          onClick={handleToggleDone}
          className={`rounded-lg px-3 py-2 text-xs font-medium ${
            done
              ? "border border-cyan-300/30 bg-cyan-400/15 text-cyan-100 hover:bg-cyan-400/20"
              : "border border-emerald-300/30 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/20"
          }`}
        >
          {done ? "Undo" : "Done"}
        </button>
      </div>
    </article>
  );

  return content;
}
