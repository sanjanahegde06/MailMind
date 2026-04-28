"use client";

import { useState } from "react";
import Navbar from "@/components/navbar";
import Sidebar from "@/components/sidebar";
import SignOutButton from "@/components/signout-button";

export default function DashboardShell({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute -left-20 top-8 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} footer={<SignOutButton />} />

      <div className="relative z-20">
        <Navbar onMenuToggle={() => setIsSidebarOpen((prev) => !prev)} />
        {children}
      </div>
    </main>
  );
}
