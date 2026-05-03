"use client";

import { useState, useRef } from "react";

export default function ClockPicker({ hour, minute, meridiem, onChange, onClose }) {
  const [selectingMode, setSelectingMode] = useState("hour");
  const [hourInput, setHourInput] = useState(hour || "12");
  const [minuteInput, setMinuteInput] = useState(minute || "00");
  const [isDragging, setIsDragging] = useState(false);
  const clockRef = useRef(null);

  const handleHourInputChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 2);
    if (!value) {
      setHourInput("");
      return;
    }
    const h = Math.min(Math.max(1, parseInt(value, 10)), 12);
    const formatted = String(h).padStart(2, "0");
    setHourInput(formatted);
    onChange({ hour: formatted, minute: minuteInput, meridiem });
  };

  const handleMinuteInputChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 2);
    if (!value) {
      setMinuteInput("");
      return;
    }
    const m = Math.min(Math.max(0, parseInt(value, 10)), 59);
    const formatted = String(m).padStart(2, "0");
    setMinuteInput(formatted);
    onChange({ hour: hourInput, minute: formatted, meridiem });
  };

  const handleMeridiemChange = (m) => {
    onChange({ hour: hourInput, minute: minuteInput, meridiem: m });
  };

  // --- Clock Face Interaction Logic ---
  const updateTimeFromEvent = (e) => {
    if (!clockRef.current) return;
    
    const rect = clockRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
    
    if (clientX === undefined || clientY === undefined) return;

    const x = clientX - centerX;
    const y = clientY - centerY;

    let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;

    if (selectingMode === "hour") {
      let h = Math.round(angle / 30);
      if (h === 0) h = 12;
      const formatted = String(h).padStart(2, "0");
      setHourInput(formatted);
      onChange({ hour: formatted, minute: minuteInput, meridiem });
    } else {
      let m = Math.round(angle / 6);
      if (m === 60) m = 0;
      const formatted = String(m).padStart(2, "0");
      setMinuteInput(formatted);
      onChange({ hour: hourInput, minute: formatted, meridiem });
    }
  };

  const handlePointerDown = (e) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateTimeFromEvent(e);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    updateTimeFromEvent(e);
  };

  const handlePointerUp = (e) => {
    if (isDragging) {
      setIsDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (selectingMode === "hour") {
        setSelectingMode("minute"); // Auto-switch to minutes
      }
    }
  };

  const renderClockFace = () => {
    const isHourMode = selectingMode === "hour";
    const currentHour = parseInt(hourInput, 10) || 12;
    const currentMinute = parseInt(minuteInput, 10) || 0;
    
    // 30 degrees per hour, 6 degrees per minute
    const angle = isHourMode ? (currentHour % 12) * 30 : currentMinute * 6;

    return (
      <div 
        ref={clockRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative mx-auto aspect-square w-48 touch-none cursor-pointer rounded-full border-4 border-slate-600/50 bg-gradient-to-br from-slate-800 to-slate-900 shadow-2xl sm:w-56 md:w-64"
        style={{ touchAction: "none" }}
      >
        {/* Center dot */}
        <div className="absolute left-1/2 top-1/2 z-[25] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400 shadow-lg" />

        {/* Hand & Thumb Indicator */}
        <div
          className="absolute bottom-1/2 left-1/2 z-[5] w-[2px] origin-bottom bg-cyan-400"
          style={{
            height: "85px", // Radius length
            transform: `translateX(-50%) rotate(${angle}deg)`,
            // Add a small transition only when NOT dragging for smooth snap
            transition: isDragging ? "none" : "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {/* Thumb circle at the end of the hand */}
          <div className="absolute -left-[19px] -top-[20px] h-10 w-10 rounded-full border-2 border-cyan-400 bg-cyan-500/40 shadow-[0_0_15px_rgba(34,211,238,0.3)]" />
        </div>

        {/* Numbers (Visual only, interactions handled by parent) */}
        {Array.from({ length: 12 }, (_, i) => {
          const num = isHourMode ? (i === 0 ? 12 : i) : i * 5;
          const numAngle = (i * 30 - 90) * (Math.PI / 180);
          const radius = 85; 
          const x = Math.cos(numAngle) * radius;
          const y = Math.sin(numAngle) * radius;

          const isSelected = isHourMode
            ? num === currentHour
            : num === currentMinute;

          return (
            <div
              key={i}
              className={`pointer-events-none absolute z-[15] flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                isSelected ? "text-cyan-100" : "text-slate-300"
              }`}
              style={{
                left: "50%",
                top: "50%",
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              }}
            >
              {String(num).padStart(2, "0")}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full max-w-sm select-none">
      <div className="rounded-2xl border border-cyan-200/20 bg-slate-950 p-4 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 sm:text-[11px] sm:tracking-[0.2em]">
              Select Time
            </p>
            <p className="mt-0.5 text-xs text-slate-300 sm:mt-1 sm:text-sm">Drag or tap to pick hour and minute</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-600/50 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-slate-300 hover:border-slate-400/60 hover:bg-slate-800 transition-colors sm:px-4 sm:py-1.5 sm:text-[10px] sm:tracking-[0.2em]"
          >
            OK
          </button>
        </div>

        {/* Time Input Display */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1 rounded-xl border border-blue-300/20 bg-slate-900/50 px-2 py-3 sm:mt-5 sm:gap-2 sm:rounded-2xl sm:px-4 sm:py-4">
          <input
            type="text"
            inputMode="numeric"
            value={hourInput}
            onChange={handleHourInputChange}
            onClick={() => setSelectingMode("hour")}
            className={`w-12 rounded-lg border-2 bg-slate-800 py-1.5 text-center text-2xl font-bold text-slate-100 outline-none transition-colors cursor-pointer sm:w-16 sm:py-2 sm:text-3xl ${
              selectingMode === "hour" 
                ? "border-cyan-400/80 bg-slate-800" 
                : "border-transparent hover:bg-slate-700/50"
            }`}
            maxLength="2"
          />
          <span className="text-2xl font-bold text-slate-300 sm:text-3xl">:</span>
          <input
            type="text"
            inputMode="numeric"
            value={minuteInput}
            onChange={handleMinuteInputChange}
            onClick={() => setSelectingMode("minute")}
            className={`w-12 rounded-lg border-2 bg-slate-800 py-1.5 text-center text-2xl font-bold text-slate-100 outline-none transition-colors cursor-pointer sm:w-16 sm:py-2 sm:text-3xl ${
              selectingMode === "minute" 
                ? "border-cyan-400/80 bg-slate-800" 
                : "border-transparent hover:bg-slate-700/50"
            }`}
            maxLength="2"
          />
          <div className="ml-1 flex flex-col gap-0.5 rounded-lg border border-blue-300/30 bg-slate-800 p-1 sm:ml-3 sm:gap-1 sm:p-1.5">
            {["AM", "PM"].map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => handleMeridiemChange(period)}
                className={`w-8 rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] transition sm:w-10 sm:px-2 sm:py-1 sm:text-xs sm:tracking-[0.1em] ${
                  meridiem === period
                    ? "border border-cyan-400/60 bg-cyan-500/40 text-cyan-100"
                    : "border border-transparent text-slate-400 hover:bg-slate-700/50"
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>

        {/* Mode Indicator */}
        <p className="mt-2 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-400 sm:mt-4 sm:tracking-[0.2em]">
          {selectingMode === "hour" ? "← Select Hour" : "← Select Minute"}
        </p>

        {/* Clock Face */}
        <div className="mt-3 flex justify-center sm:mt-6">
          {renderClockFace()}
        </div>

        {/* Quick minute buttons (Optional shortcuts) */}
        {selectingMode === "minute" && (
          <div className="mt-4 grid grid-cols-6 gap-1 sm:mt-8 sm:gap-2">
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => {
                  const formatted = String(min).padStart(2, "0");
                  setMinuteInput(formatted);
                  onChange({ hour: hourInput, minute: formatted, meridiem });
                }}
                className={`rounded-lg border py-1 text-xs font-semibold transition sm:py-2 sm:text-sm ${
                  parseInt(minuteInput, 10) === min
                    ? "border-cyan-400/60 bg-cyan-500/30 text-cyan-100"
                    : "border-blue-300/20 bg-slate-900/50 text-slate-300 hover:border-cyan-300/50 hover:bg-slate-800"
                }`}
              >
                {String(min).padStart(2, "0")}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}