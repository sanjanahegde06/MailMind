"use client";

import CalendarPicker from "@/components/calendar-picker";
import ClockPicker from "@/components/clock-picker";
import TaskCard from "@/components/task-card";
import { useEffect, useState } from "react";

const BACKEND_BASE_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

const PRIORITY_ORDER_DESC = { High: 0, Medium: 1, Low: 2 };
const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Done" },
];

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

function parseDeadlineAt(task) {
  const raw = String(task?.deadline_at || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameDay(left, right) {
  if (!left || !right) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getTaskStatus(task, now = new Date()) {
  const deadlineAt = parseDeadlineAt(task);
  if (!deadlineAt) return { label: "", tone: "" };

  if (!task.done && deadlineAt.getTime() < now.getTime()) {
    return { label: "Overdue", tone: "overdue" };
  }

  if (isSameDay(deadlineAt, now)) {
    return { label: "Today", tone: "today" };
  }

  return { label: "Upcoming", tone: "upcoming" };
}

function formatDeadline(task) {
  const deadlineAt = parseDeadlineAt(task);
  if (!deadlineAt) return task.deadline || "Not specified";

  return deadlineAt.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatReminderPreview(dateValue, hourValue, minuteValue, meridiemValue) {
  if (!dateValue || hourValue === "" || minuteValue === "" || !meridiemValue) {
    return "Select date and time";
  }

  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return "Select date and time";
  }

  let normalizedHour = hour % 12;
  if (meridiemValue === "PM") {
    normalizedHour += 12;
  }

  const [year, month, day] = dateValue.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return "Select date and time";
  }

  const preview = new Date(year, month - 1, day, normalizedHour, minute);
  if (Number.isNaN(preview.getTime())) {
    return "Select date and time";
  }

  return preview.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [sortByPriority, setSortByPriority] = useState("desc");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [reminderTask, setReminderTask] = useState(null);
  const [reminderDate, setReminderDate] = useState("");
  const [reminderHour, setReminderHour] = useState("09");
  const [reminderMinute, setReminderMinute] = useState("00");
  const [reminderMeridiem, setReminderMeridiem] = useState("AM");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [savingReminders, setSavingReminders] = useState(false);
  const [now, setNow] = useState(() => new Date());

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
      const response = await fetch(`${BACKEND_BASE_URL}/tasks/${encodeURIComponent(emailId)}/done?done=${nextDone}`, {
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
      const response = await fetch(`${BACKEND_BASE_URL}/tasks/${encodeURIComponent(emailId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete task");
      }

      setTasks((previous) => previous.filter((item) => item.email_id !== emailId));
      setSelectedIds((previous) => {
        const next = new Set(previous);
        next.delete(emailId);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) {
      return;
    }

    const confirmed = window.confirm("Delete the selected tasks? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    try {
      setError("");
      const emailIds = Array.from(selectedIds);
      const response = await fetch("http://localhost:8000/tasks/delete-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email_ids: emailIds }),
      });

      if (!response.ok) {
        throw new Error("Unable to delete selected tasks");
      }

      setTasks((previous) => previous.filter((item) => !selectedIds.has(item.email_id)));
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  function handleSelectTask(task, checked) {
    const emailId = String(task?.email_id || "").trim();
    if (!emailId) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(emailId);
      } else {
        next.delete(emailId);
      }
      return next;
    });
  }

  function handleSelectAll(visibleTasks) {
    if (!visibleTasks.length) {
      return;
    }

    const allSelected = visibleTasks.every((task) => selectedIds.has(task.email_id));
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allSelected) {
        visibleTasks.forEach((task) => next.delete(task.email_id));
      } else {
        visibleTasks.forEach((task) => next.add(task.email_id));
      }
      return next;
    });
  }

  function openReminderEditor(task) {
    setReminderTask(task);
    setReminderDate("");
    setReminderHour("09");
    setReminderMinute("00");
    setReminderMeridiem("AM");
    setShowDatePicker(false);
    setShowTimePicker(false);
  }

  function closeReminderEditor() {
    setReminderTask(null);
    setReminderDate("");
    setShowDatePicker(false);
    setShowTimePicker(false);
  }

  function computeCandidateReminder() {
    if (!reminderDate) return null;

    const hour = Number(reminderHour);
    const minute = Number(reminderMinute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    let normalizedHour = hour % 12;
    if (reminderMeridiem === "PM") {
      normalizedHour += 12;
    }

    const [year, month, day] = reminderDate.split("-").map((part) => Number(part));
    if (!year || !month || !day) return null;

    const candidate = new Date(year, month - 1, day, normalizedHour, minute);
    if (Number.isNaN(candidate.getTime())) return null;
    if (candidate.getTime() < Date.now()) return null;

    return candidate;
  }

  function addReminderTime() {
    const newDate = computeCandidateReminder();
    if (!newDate) return;

    const iso = newDate.toISOString();
    setReminderTask((previous) => {
      if (!previous) return previous;
      const existing = Array.from(previous.custom_reminders || []);
      if (existing.includes(iso)) return previous;
      return { ...previous, custom_reminders: [...existing, iso].sort() };
    });
    setReminderDate("");
    setShowDatePicker(false);
    setShowTimePicker(false);
  }

  function removeReminderTime(value) {
    setReminderTask((previous) => {
      if (!previous) return previous;
      const next = Array.from(previous.custom_reminders || []).filter((item) => item !== value);
      return { ...previous, custom_reminders: next };
    });
  }

  async function saveReminderTimes() {
    if (!reminderTask) return;
    const emailId = String(reminderTask.email_id || "").trim();
    if (!emailId) return;

    try {
      setSavingReminders(true);
      const response = await fetch(`${BACKEND_BASE_URL}/tasks/${encodeURIComponent(emailId)}/reminders`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reminders: reminderTask.custom_reminders || [] }),
      });

      if (!response.ok) {
        throw new Error("Unable to update reminders");
      }

      setTasks((previous) =>
        previous.map((item) =>
          item.email_id === emailId ? { ...item, custom_reminders: reminderTask.custom_reminders || [] } : item,
        ),
      );
      closeReminderEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSavingReminders(false);
    }
  }

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(intervalId);
  }, []);

  const sortedTasks = sortTasksByPriority(tasks, sortByPriority);
  const filteredTasks = sortedTasks.filter((task) => {
    if (statusFilter === "all") return !task.done;
    const status = getTaskStatus(task, now);
    if (statusFilter === "done") return Boolean(task.done);
    if (statusFilter === "overdue") return !task.done && status.tone === "overdue";
    if (statusFilter === "today") return !task.done && status.tone === "today";
    if (statusFilter === "upcoming") return !task.done && status.tone === "upcoming";
    return true;
  });
  const allVisibleSelected =
    filteredTasks.length > 0 && filteredTasks.every((task) => selectedIds.has(task.email_id));

  return (
    <section className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
      <div className="mb-4 rounded-2xl border border-cyan-300/25 bg-gradient-to-r from-indigo-700/75 via-sky-700/75 to-cyan-600/70 p-4 sm:rounded-3xl sm:p-6 md:mb-6 md:p-8 text-white shadow-[0_16px_50px_rgba(21,94,239,0.28)]">
        <h1 className="text-2xl font-semibold sm:text-3xl">Important Tasks</h1>
        <p className="mt-1 text-xs text-cyan-50/90 sm:mt-2 sm:text-sm">Structured tasks extracted from your emails by AI.</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3 md:mt-4">
          <label className="text-xs text-cyan-50/90 sm:text-sm" htmlFor="sortPriority">
            Sort by priority
          </label>
          <select
            id="sortPriority"
            className="rounded-lg border border-cyan-200/30 bg-slate-900/60 px-2.5 py-1.5 text-xs text-cyan-50 sm:px-3 sm:py-2 sm:text-sm"
            value={sortByPriority}
            onChange={(event) => setSortByPriority(event.target.value)}
          >
            <option value="desc">High to Low</option>
            <option value="asc">Low to High</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-3 md:mt-5">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.15em] transition sm:px-4 sm:py-1 sm:tracking-[0.2em] ${
                statusFilter === filter.id
                  ? "border-white/70 bg-white/10 text-white"
                  : "border-cyan-200/30 text-cyan-100/80 hover:border-cyan-100/60"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {!isLoading && !error && tasks.length > 0 ? (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-xs text-slate-200 shadow-sm sm:mb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() => handleSelectAll(filteredTasks)}
              className="h-3 w-3 rounded border-blue-300/40 bg-slate-900 text-cyan-400 sm:h-4 sm:w-4"
            />
            <span className="text-xs sm:text-sm">Select all</span>
          </label>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-xs text-slate-300">{selectedIds.size} selected</span>
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0}
              className={`rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-[0.15em] transition sm:px-3 sm:py-2 sm:tracking-[0.18em] ${
                selectedIds.size === 0
                  ? "cursor-not-allowed border border-slate-600/40 text-slate-400"
                  : "border border-rose-300/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
              }`}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-xl border border-blue-400/25 bg-slate-900/75 p-4 text-sm text-slate-200 shadow-sm backdrop-blur sm:rounded-2xl sm:p-6">
          Loading tasks...
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-4 text-sm text-rose-100 shadow-sm sm:rounded-2xl sm:p-6">{error}</div>
      ) : null}

      {!isLoading && !error && tasks.length === 0 ? (
        <div className="rounded-xl border border-blue-400/25 bg-slate-900/75 p-4 text-sm text-slate-300 shadow-sm backdrop-blur sm:rounded-2xl sm:p-6">
          No tasks available yet. Open Dashboard to process your latest emails.
        </div>
      ) : null}

      {!isLoading && !error && filteredTasks.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 md:gap-4 lg:gap-5 xl:grid-cols-3">
          {filteredTasks.map((task, index) => (
            <TaskCard
              key={`${task.email_id || "task"}-${index}`}
              task={{
                ...task,
                deadlineDisplay: formatDeadline(task),
                status: getTaskStatus(task, now),
                selected: selectedIds.has(task.email_id),
                onSelect: handleSelectTask,
                onDelete: handleDelete,
                onToggleDone: handleToggleDone,
                onEditReminders: openReminderEditor,
              }}
            />
          ))}
        </div>
      ) : null}

      {reminderTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-3 py-4 sm:px-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur"
            aria-label="Close reminder editor"
            onClick={closeReminderEditor}
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-cyan-200/20 bg-slate-950 p-4 text-slate-100 shadow-2xl sm:rounded-3xl sm:p-6 md:p-7">
            <h2 className="text-base font-semibold sm:text-lg">Customize Reminder</h2>
            <p className="mt-1 text-xs text-slate-400">Pick a date, then choose a time. Add as many as you need.</p>

            <div className="mt-3 space-y-2 sm:mt-5 sm:space-y-3">
              {(reminderTask.custom_reminders || []).length === 0 ? (
                <p className="text-sm text-slate-400">No custom reminders yet.</p>
              ) : (
                (reminderTask.custom_reminders || []).map((reminder) => (
                  <div
                    key={reminder}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-blue-300/20 bg-slate-900/70 px-4 py-2.5 text-xs shadow-sm"
                  >
                    <span className="text-slate-100">{new Date(reminder).toLocaleString()}</span>
                    <button
                      type="button"
                      onClick={() => removeReminderTime(reminder)}
                      className="rounded-full border border-rose-300/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-100 hover:border-rose-200/60 hover:bg-rose-500/10"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 rounded-xl border border-blue-300/20 bg-slate-900/60 p-3 shadow-sm sm:mt-6 sm:rounded-2xl sm:p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">Step 1 • Pick a date</p>
              <div className="relative mt-3">
                <button
                  type="button"
                  onClick={() => setShowDatePicker(true)}
                  className="flex w-full items-center justify-between rounded-2xl border border-blue-300/30 bg-slate-950 px-4 py-3 text-sm text-slate-100 shadow-inner hover:border-cyan-300/50"
                >
                  <span>{reminderDate ? formatReminderPreview(reminderDate, "09", "00", "AM").split(" at ")[0] : "Select a date"}</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">Calendar</span>
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-blue-300/20 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 shadow-sm sm:mt-5 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">Selected</p>
                  <p className="mt-1 text-xs text-slate-100 sm:text-sm">
                    {formatReminderPreview(reminderDate, reminderHour, reminderMinute, reminderMeridiem)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addReminderTime}
                  disabled={!computeCandidateReminder()}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] transition sm:px-4 sm:py-2 sm:tracking-[0.2em] ${
                    computeCandidateReminder()
                      ? "border border-cyan-300/50 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30"
                      : "cursor-not-allowed border border-slate-600/40 text-slate-500"
                  }`}
                >
                  Add Reminder
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:mt-6 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={closeReminderEditor}
                className="rounded-lg border border-slate-600/50 px-3 py-2 text-xs text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveReminderTimes}
                disabled={savingReminders}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                  savingReminders
                    ? "cursor-not-allowed border border-cyan-200/40 text-cyan-200/60"
                    : "border border-cyan-300/50 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30"
                }`}
              >
                Save Reminders
              </button>
            </div>

            {showDatePicker ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center px-4">
                <button
                  type="button"
                  aria-label="Close date picker"
                  className="absolute inset-0 bg-slate-950/70"
                  onClick={() => setShowDatePicker(false)}
                />
                <div className="relative animate-[fadeInUp_0.2s_ease-out]">
                  <CalendarPicker
                    value={reminderDate}
                    onChange={(date) => {
                      setReminderDate(date);
                      setShowDatePicker(false);
                      setShowTimePicker(true);
                    }}
                    minDate={new Date().toISOString().split("T")[0]}
                    onClose={() => setShowDatePicker(false)}
                  />
                </div>
              </div>
            ) : null}

            {showTimePicker ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center px-4">
                <button
                  type="button"
                  aria-label="Close time picker"
                  className="absolute inset-0 bg-slate-950/70"
                  onClick={() => setShowTimePicker(false)}
                />
                <div className="relative animate-[fadeInUp_0.2s_ease-out]">
                  <ClockPicker
                    hour={reminderHour}
                    minute={reminderMinute}
                    meridiem={reminderMeridiem}
                    onChange={(values) => {
                      setReminderHour(values.hour);
                      setReminderMinute(values.minute);
                      setReminderMeridiem(values.meridiem);
                    }}
                    onClose={() => setShowTimePicker(false)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
