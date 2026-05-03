"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Important Tasks", href: "/tasks" },
  { label: "Settings", href: "/settings" },
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
        className={`fixed left-0 top-0 z-50 flex h-full w-56 flex-col border-r border-blue-400/20 bg-slate-900/95 p-3 shadow-2xl backdrop-blur transition-transform duration-300 sm:w-64 sm:p-4 md:w-72 md:p-5 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between sm:mb-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-cyan-100 sm:text-sm">MAILMIND</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300/25 bg-blue-400/10 text-sm text-cyan-100 transition hover:bg-blue-400/20 sm:h-9 sm:w-9"
          >
            ✕
          </button>
        </div>

        <nav className="space-y-2 sm:space-y-3">
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
                className={`block rounded-lg px-3 py-2 text-xs font-medium transition sm:rounded-xl sm:px-4 sm:py-3 sm:text-sm ${
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

        {footer ? <div className="mt-auto pt-4 sm:pt-6">{footer}</div> : null}
      </aside>
    </>
  );
}
