"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Important Tasks", href: "/tasks" },
];

export default function Sidebar({ isOpen, onClose, footer }) {
  const pathname = usePathname();

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-blue-400/20 bg-slate-900/95 p-5 shadow-2xl backdrop-blur transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-8 flex items-center justify-between">
          <p className="text-sm font-semibold tracking-[0.22em] text-cyan-100">MAILMIND</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300/25 bg-blue-400/10 text-cyan-100 transition hover:bg-blue-400/20"
          >
            ✕
          </button>
        </div>

        <nav className="space-y-3">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard" || pathname.startsWith("/dashboard/")
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`block rounded-xl px-4 py-3 text-sm font-medium transition ${
                  active
                    ? "border border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                    : "border border-transparent bg-white/0 text-slate-200 hover:border-blue-300/25 hover:bg-blue-500/10"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {footer ? <div className="mt-auto pt-6">{footer}</div> : null}
      </aside>
    </>
  );
}
