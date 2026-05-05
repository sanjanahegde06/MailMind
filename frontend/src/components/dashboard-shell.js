"use client";

import { useState } from "react";
import Navbar from "@/components/navbar";
import Sidebar from "@/components/sidebar";
import SignOutButton from "@/components/signout-button";
import PushNotificationManager from "@/components/push-notification-manager";
import TaskNotificationManager from "@/components/task-notification-manager";

export default function DashboardShell({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute -left-20 top-8 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl sm:h-64 sm:w-64 md:top-8 md:-left-20" />
      <div className="pointer-events-none absolute -right-28 bottom-0 h-60 w-60 rounded-full bg-blue-500/20 blur-3xl sm:h-80 sm:w-80" />

      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} footer={<SignOutButton />} />

      <div className="relative z-20">
        <Navbar onMenuToggle={() => setIsSidebarOpen((prev) => !prev)} />
        <TaskNotificationManager />
        <PushNotificationManager />
        {children}
      </div>
    </main>
  );
}
