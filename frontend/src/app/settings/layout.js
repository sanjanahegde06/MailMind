import DashboardShell from "@/components/dashboard-shell";
import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export default async function SettingsLayout({ children }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
