import NotificationSettings from "@/components/notification-settings";

export default function SettingsPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 rounded-2xl border border-cyan-200/25 bg-gradient-to-r from-slate-900 via-slate-900 to-blue-900/40 p-5 text-slate-100 shadow-lg sm:rounded-3xl sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Settings</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Notification Preferences</h1>
        <p className="mt-2 text-sm text-slate-300">
          Control device alerts for important emails and task reminders.
        </p>
      </div>

      <NotificationSettings />
    </section>
  );
}
