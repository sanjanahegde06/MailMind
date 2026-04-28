import Link from "next/link";

export default function EmailCard({ email }) {
  return (
    <Link
      href={`/dashboard/email/${email.id}`}
      className="group block w-full px-4 py-4 transition hover:bg-blue-500/10"
    >
      <div className="mb-1 flex items-start justify-between gap-4">
        <h2 className="line-clamp-1 text-base font-semibold text-slate-100 group-hover:text-cyan-100">{email.subject}</h2>
        <span className="shrink-0 rounded-full border border-blue-300/25 bg-blue-400/10 px-2 py-1 text-[11px] text-slate-300">
          {email.date || ""}
        </span>
      </div>
      <p className="line-clamp-1 text-sm text-cyan-200/90">{email.from || "Unknown sender"}</p>
      <p className="mt-1 line-clamp-1 text-sm text-slate-300">{email.snippet}</p>
    </Link>
  );
}
