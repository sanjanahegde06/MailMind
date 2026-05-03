"use client";

import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 60000;
const REMINDER_GRACE_MS = 10 * 60 * 1000;
const IMMEDIATE_GRACE_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = "mailmind.reminders.sent";
const BACKEND_BASE_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
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

function loadSentReminders() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSentReminders(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage errors.
  }
}

function buildReminderSchedule(task) {
  const deadlineAt = parseDate(task.deadline_at);
  if (!deadlineAt || task.done) return [];

  const schedule = [];
  const customReminders = Array.isArray(task.custom_reminders) ? task.custom_reminders : [];
  const createdAt = parseDate(task.created_at);

  for (const reminder of customReminders) {
    const time = parseDate(reminder);
    if (!time) continue;
    schedule.push({
      id: `custom:${task.email_id}:${time.toISOString()}`,
      time,
    });
  }

  const oneDay = new Date(deadlineAt.getTime() - 24 * 60 * 60 * 1000);
  const oneHour = new Date(deadlineAt.getTime() - 60 * 60 * 1000);
  schedule.push({ id: `default:day:${task.email_id}:${oneDay.toISOString()}`, time: oneDay });
  schedule.push({ id: `default:hour:${task.email_id}:${oneHour.toISOString()}`, time: oneHour });

  if (createdAt && isSameDay(createdAt, deadlineAt)) {
    schedule.push({ id: `immediate:${task.email_id}:${deadlineAt.toISOString()}`, time: createdAt });
  }

  return schedule;
}

function formatDeadline(task) {
  const deadlineAt = parseDate(task.deadline_at);
  if (!deadlineAt) return task.deadline || "Not specified";

  return deadlineAt.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function TaskNotificationManager() {
  const pollerRef = useRef(null);
  const permissionPromptedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function ensurePermissionFromGesture(fromGesture = false) {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "default") return;
      if (!fromGesture) return;
      if (permissionPromptedRef.current) return;

      permissionPromptedRef.current = true;
      try {
        await Notification.requestPermission();
      } catch {
        // Ignore permission errors.
      }
    }

    async function checkReminders() {
      if (!isMounted) return;
      if (typeof Notification === "undefined") return;

      if (Notification.permission === "default") {
        await ensurePermissionFromGesture(false);
      }

      if (Notification.permission !== "granted") return;

      let tasks = [];
      try {
        const response = await fetch(`${BACKEND_BASE_URL}/tasks`, { cache: "no-store" });
        if (!response.ok) return;
        tasks = await response.json();
      } catch {
        return;
      }

      const now = Date.now();
      const sent = loadSentReminders();
      let updated = false;

      for (const task of tasks) {
        const schedule = buildReminderSchedule(task);
        for (const reminder of schedule) {
          const reminderTime = reminder.time.getTime();
          const isImmediate = reminder.id.startsWith("immediate:");
          const graceWindow = isImmediate ? IMMEDIATE_GRACE_MS : REMINDER_GRACE_MS;
          if (reminderTime > now || now - reminderTime > graceWindow) {
            continue;
          }

          if (sent[reminder.id]) {
            continue;
          }

          const taskTitle = task.task || "Task reminder";
          const deadline = formatDeadline(task);
          const body = `Task: ${taskTitle}\nDeadline: ${deadline}`;

          try {
            const notification = new Notification("MailMind Reminder", {
              body,
              tag: reminder.id,
            });

            notification.onclick = () => {
              const emailId = String(task.email_id || "").trim();
              const target = emailId ? `/dashboard/email/${encodeURIComponent(emailId)}` : "/tasks";
              window.open(target, "_blank", "noopener");
            };

            sent[reminder.id] = new Date().toISOString();
            updated = true;
          } catch {
            // Ignore notification errors.
          }
        }
      }

      if (updated) {
        saveSentReminders(sent);
      }
    }

    const handleUserGesture = () => {
      ensurePermissionFromGesture(true).then(checkReminders);
    };

    window.addEventListener("click", handleUserGesture, { once: true });
    window.addEventListener("keydown", handleUserGesture, { once: true });
    window.addEventListener("touchstart", handleUserGesture, { once: true });

    checkReminders();
    pollerRef.current = setInterval(checkReminders, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.removeEventListener("click", handleUserGesture);
      window.removeEventListener("keydown", handleUserGesture);
      window.removeEventListener("touchstart", handleUserGesture);
      if (pollerRef.current) {
        clearInterval(pollerRef.current);
      }
    };
  }, []);

  return null;
}
