import "./globals.css";
import TaskNotificationManager from "@/components/task-notification-manager";

export const metadata = {
  title: "MailMind",
  description: "AI-powered email understanding dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <TaskNotificationManager />
        {children}
      </body>
    </html>
  );
}
