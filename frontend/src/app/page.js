import GoogleSignInButton from "@/components/google-signin-button";
import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-6 py-20 text-slate-100">
      <div className="pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />

      <section className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-8 rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur md:p-14">
        <h1 className="text-balance text-4xl font-semibold leading-tight md:text-5xl">
          MailMind turns your inbox into a smart task manager.
        </h1>
        <p className="max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
          Sign in with Google to fetch your latest emails.
        </p>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <GoogleSignInButton />
        </div>
      </section>
    </main>
  );
}
