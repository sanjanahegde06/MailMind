"use client";

import TaskCard from "@/components/task-card";
import { useEffect, useState } from "react";

const PRIORITY_ORDER_DESC = { High: 0, Medium: 1, Low: 2 };

function normalizePriority(priority) {
  const raw = String(priority || "").toLowerCase();
  if (raw.startsWith("h")) return "High";
  if (raw.startsWith("l")) return "Low";
  return "Medium";
}

function sortTasksByPriority(tasks, direction) {
  const multiplier = direction === "asc" ? -1 : 1;
  return [...tasks].sort((a, b) => {
    const left = PRIORITY_ORDER_DESC[normalizePriority(a.priority)] ?? 99;
    const right = PRIORITY_ORDER_DESC[normalizePriority(b.priority)] ?? 99;
    if (left === right) {
      return 0;
    }
    return left < right ? -1 * multiplier : 1 * multiplier;
  });
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [sortByPriority, setSortByPriority] = useState("desc");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function fetchTasks() {
    try {
      setIsLoading(true);
      setError("");

      // Ensure new emails are processed even when user opens Tasks first.
      await fetch("/api/process-emails?maxResults=20", {
        method: "GET",
        cache: "no-store",
      });

      const response = await fetch("http://localhost:8000/tasks", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch tasks from backend");
      }

      const data = await response.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleDone(task) {
    const emailId = String(task?.email_id || "").trim();
    if (!emailId) {
      return;
    }

    try {
      const nextDone = !Boolean(task.done);
      const response = await fetch(`http://localhost:8000/tasks/${encodeURIComponent(emailId)}/done?done=${nextDone}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error("Unable to update task status");
      }

      setTasks((previous) =>
        previous.map((item) => (item.email_id === emailId ? { ...item, done: nextDone } : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleDelete(task) {
    const emailId = String(task?.email_id || "").trim();
    if (!emailId) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:8000/tasks/${encodeURIComponent(emailId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete task");
      }

      setTasks((previous) => previous.filter((item) => item.email_id !== emailId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  useEffect(() => {
    fetchTasks();
  }, []);

  const sortedTasks = sortTasksByPriority(tasks, sortByPriority);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 rounded-3xl border border-cyan-300/25 bg-gradient-to-r from-indigo-700/75 via-sky-700/75 to-cyan-600/70 p-8 text-white shadow-[0_16px_50px_rgba(21,94,239,0.28)]">
        <h1 className="text-3xl font-semibold">Important Tasks</h1>
        <p className="mt-2 text-cyan-50/90">Structured tasks extracted from your emails by AI.</p>
        <div className="mt-4 flex items-center gap-3">
          <label className="text-sm text-cyan-50/90" htmlFor="sortPriority">
            Sort by priority
          </label>
          <select
            id="sortPriority"
            className="rounded-lg border border-cyan-200/30 bg-slate-900/60 px-3 py-2 text-sm text-cyan-50"
            value={sortByPriority}
            onChange={(event) => setSortByPriority(event.target.value)}
          >
            <option value="desc">High to Low</option>
            <option value="asc">Low to High</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-blue-400/25 bg-slate-900/75 p-6 text-slate-200 shadow-sm backdrop-blur">
          Loading tasks...
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="rounded-2xl border border-rose-300/35 bg-rose-500/10 p-6 text-rose-100 shadow-sm">{error}</div>
      ) : null}

      {!isLoading && !error && tasks.length === 0 ? (
        <div className="rounded-2xl border border-blue-400/25 bg-slate-900/75 p-6 text-slate-300 shadow-sm backdrop-blur">
          No tasks available yet. Open Dashboard to process your latest emails.
        </div>
      ) : null}

      {!isLoading && !error && sortedTasks.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedTasks.map((task, index) => (
            <TaskCard
              key={`${task.email_id || "task"}-${index}`}
              task={{ ...task, onDelete: handleDelete, onToggleDone: handleToggleDone }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
