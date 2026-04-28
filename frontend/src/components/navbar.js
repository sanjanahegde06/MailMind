"use client";

export default function Navbar({ onMenuToggle }) {
  return (
    <header className="sticky top-0 z-30 border-b border-blue-400/20 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={onMenuToggle}
          aria-label="Open navigation menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-blue-300/30 bg-blue-400/10 text-xl text-cyan-100 transition hover:bg-blue-400/20"
        >
          ☰
        </button>
        <p className="text-sm font-semibold tracking-[0.2em] text-cyan-100/90 sm:text-base">MAILMIND DASHBOARD</p>
      </div>
    </header>
  );
}
