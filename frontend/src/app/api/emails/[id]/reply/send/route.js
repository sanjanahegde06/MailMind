import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const BACKEND_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

export async function POST(request, context) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const resolvedParams = await context.params;
    const rawId = resolvedParams?.id;
    const normalizedId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!normalizedId) {
      return Response.json({ error: "Missing email id" }, { status: 400 });
    }

    const emailId = decodeURIComponent(String(normalizedId));
    const body = await request.json().catch(() => ({}));
    const replyText = String(body.reply || "");

    if (!replyText) {
      return Response.json({ error: "reply text is required" }, { status: 400 });
    }

    const sendRes = await fetch(`${BACKEND_BASE}/send-reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ email_id: emailId, reply_text: replyText }),
      cache: "no-store",
    });

    if (!sendRes.ok) {
      const text = await sendRes.text().catch(() => "Unknown error");
      return Response.json({ error: `Failed to send reply: ${sendRes.status} ${text}` }, { status: sendRes.status });
    }

    const data = await sendRes.json();
    return Response.json({ ok: true, message: data?.message || "Reply sent" });
  } catch (error) {
    return Response.json({ error: "Unexpected server error", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
