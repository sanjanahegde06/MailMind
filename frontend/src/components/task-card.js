"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

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
  const statusLabel = task.status?.label || "";
  const statusTone = task.status?.tone || "";
  const selected = Boolean(task.selected);

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

  const handleSelect = (event) => {
    event.stopPropagation();
    if (typeof task.onSelect === "function") {
      task.onSelect(task, event.target.checked);
    }
  };

  const handleEditReminders = (event) => {
    event.stopPropagation();
    if (typeof task.onEditReminders === "function") {
      task.onEditReminders(task);
    }
  };

  const toneClass =
    statusTone === "overdue"
      ? "border-rose-300/50 bg-rose-500/10"
      : "border-blue-400/20 bg-slate-900/75";

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setMenuOpen(false);
    if (menuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [menuOpen]);

  const content = (
    <article
      className={`relative rounded-lg border p-3 shadow-lg backdrop-blur transition hover:border-cyan-300/35 hover:bg-slate-900 sm:rounded-2xl sm:p-4 md:p-5 ${toneClass}`}
    >
      <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
          <h2 className={`text-sm font-semibold sm:text-base ${done ? "text-slate-400 line-through" : "text-slate-100"} flex-1 break-words`}>
            {task.task || "No task title"}
          </h2>
          <button
            type="button"
            onClick={handleMenuToggle}
            className="relative inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-blue-300/25 bg-slate-800/70 text-xs text-slate-200 hover:bg-slate-700 sm:h-8 sm:w-8"
            aria-label="More actions"
          >
            ...
          </button>
          {menuOpen ? (
            <div className="absolute right-2 top-10 z-10 min-w-24 rounded-lg border border-rose-300/25 bg-slate-900 p-1 shadow-xl sm:right-4 sm:top-12 sm:min-w-28">
              <button
                type="button"
                onClick={handleDelete}
                className="w-full rounded-md px-3 py-2 text-left text-xs text-rose-200 hover:bg-rose-500/20 sm:text-sm"
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1 sm:gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={selected}
              onChange={handleSelect}
              className="h-3 w-3 rounded border-blue-300/40 bg-slate-900 text-cyan-400 sm:h-4 sm:w-4"
            />
          </label>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium flex-shrink-0 ${PRIORITY_STYLES[normalized]}`}>
            {normalized}
          </span>
          {statusLabel ? (
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] flex-shrink-0 sm:px-3 sm:py-1 sm:tracking-[0.18em] ${
                statusTone === "overdue"
                  ? "border-rose-300/40 bg-rose-500/15 text-rose-100"
                  : statusTone === "today"
                    ? "border-amber-300/40 bg-amber-500/15 text-amber-100"
                    : "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
              }`}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-slate-300 sm:text-sm break-words">
        Deadline: <span className="font-medium text-cyan-100">{task.deadlineDisplay || task.deadline || "Not specified"}</span>
      </p>
      <p className="mt-2 text-xs text-cyan-200/80 sm:mt-3">
        {canOpenEmail ? (
          <Link className="underline decoration-cyan-300/50 underline-offset-2 break-words" href={`/dashboard/email/${encodeURIComponent(emailId)}`}>
            Click to open the source email
          </Link>
        ) : (
          "Source email not available"
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:mt-4 sm:gap-2">
        <button
          type="button"
          onClick={handleToggleDone}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:py-2 ${
            done
              ? "border border-cyan-300/30 bg-cyan-400/15 text-cyan-100 hover:bg-cyan-400/20"
              : "border border-emerald-300/30 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/20"
          }`}
        >
          {done ? "Undo" : "Done"}
        </button>
        <button
          type="button"
          onClick={handleEditReminders}
          className="rounded-lg border border-blue-300/30 bg-blue-400/15 px-2.5 py-1.5 text-xs font-medium text-blue-100 transition hover:bg-blue-400/20 sm:px-3 sm:py-2"
        >
          Reminders
        </button>
      </div>
    </article>
  );

  return content;
}
