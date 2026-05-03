import Link from "next/link";

export default function EmailCard({ email }) {
  return (
    <Link
      href={`/dashboard/email/${email.id}`}
      className="group block w-full px-3 py-3 transition hover:bg-blue-500/10 sm:px-4 sm:py-4"
    >
      <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <h2 className="line-clamp-2 text-sm font-semibold text-slate-100 group-hover:text-cyan-100 sm:line-clamp-1 sm:text-base">{email.subject}</h2>
        <span className="shrink-0 rounded-full border border-blue-300/25 bg-blue-400/10 px-2 py-0.5 text-[10px] text-slate-300 sm:px-2 sm:py-1 sm:text-[11px]">
          {email.date || ""}
        </span>
      </div>
      <p className="line-clamp-1 text-xs text-cyan-200/90 sm:text-sm">{email.from || "Unknown sender"}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-300 sm:line-clamp-1 sm:text-sm">{email.snippet}</p>
    </Link>
  );
}
