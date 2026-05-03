"use client";

import { useState } from "react";

export default function CalendarPicker({ value, onChange, minDate, onClose }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (value) {
      const [year, month] = value.split("-");
      return new Date(year, month - 1, 1);
    }
    return new Date();
  });

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const generateCalendarDays = () => {
    const daysInMonth = getDaysInMonth(currentMonth);
    const firstDay = getFirstDayOfMonth(currentMonth);
    const days = [];

    // Add empty cells for days before the month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    return days;
  };

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleDayClick = (day) => {
    if (!day) return;

    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    const dateValue = `${year}-${month}-${dayStr}`;

    onChange(dateValue);
    if (onClose) onClose();
  };

  const isDateDisabled = (day) => {
    if (!day) return true;

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const testDate = new Date(year, month, day);

    if (minDate) {
      const minParts = minDate.split("-");
      const minDateObj = new Date(minParts[0], minParts[1] - 1, minParts[2]);
      if (testDate < minDateObj) return true;
    }

    return false;
  };

  const isDateSelected = (day) => {
    if (!day || !value) return false;

    const [year, month, dayStr] = value.split("-");
    return (
      parseInt(year) === currentMonth.getFullYear() &&
      parseInt(month) === currentMonth.getMonth() + 1 &&
      parseInt(dayStr) === day
    );
  };

  const isDateToday = (day) => {
    if (!day) return false;

    const today = new Date();
    return (
      day === today.getDate() &&
      currentMonth.getMonth() === today.getMonth() &&
      currentMonth.getFullYear() === today.getFullYear()
    );
  };

  const calendarDays = generateCalendarDays();
  const monthName = currentMonth.toLocaleString("default", { month: "long" });
  const year = currentMonth.getFullYear();

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-2xl border border-cyan-200/20 bg-slate-950 p-4 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">
              Calendar
            </p>
            <p className="mt-0.5 text-base font-semibold text-slate-100 sm:mt-1 sm:text-lg">
              {monthName} {year}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-600/50 px-2.5 py-1 text-[9px] uppercase tracking-[0.15em] text-slate-300 hover:border-slate-400/60 sm:px-3 sm:py-1 sm:text-[10px] sm:tracking-[0.2em]"
          >
            Close
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 sm:mt-4 sm:gap-3">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="rounded-lg border border-blue-300/30 bg-slate-900/50 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-900 hover:border-cyan-300/50 sm:px-3 sm:py-2 sm:text-sm"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={handleNextMonth}
            className="rounded-lg border border-blue-300/30 bg-slate-900/50 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-900 hover:border-cyan-300/50 sm:px-3 sm:py-2 sm:text-sm"
          >
            Next →
          </button>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1.5 sm:mt-5 sm:gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
            <div
              key={dayName}
              className="rounded-lg border border-blue-300/15 bg-slate-900/40 py-1.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-[0.1em] sm:py-2 sm:tracking-[0.15em]"
            >
              {dayName.slice(0, 2)}
            </div>
          ))}

          {calendarDays.map((day, index) => {
            const disabled = isDateDisabled(day);
            const selected = isDateSelected(day);
            const isToday = isDateToday(day);

            return (
              <button
                key={index}
                type="button"
                disabled={disabled}
                onClick={() => handleDayClick(day)}
                className={`rounded-lg border py-1.5 text-center text-xs font-semibold transition sm:py-3 sm:text-sm ${
                  !day
                    ? "cursor-default border-transparent bg-transparent"
                    : disabled
                      ? "cursor-not-allowed border-slate-600/30 bg-slate-900/30 text-slate-500"
                      : selected
                        ? "border-cyan-300/60 bg-cyan-500/30 text-cyan-100"
                        : isToday
                          ? "border-amber-300/40 bg-amber-500/15 text-amber-100"
                          : "border-blue-300/20 bg-slate-900/50 text-slate-200 hover:border-cyan-300/50 hover:bg-slate-900"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
