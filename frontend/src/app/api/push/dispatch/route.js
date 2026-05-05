import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL;
const PUSH_DISPATCH_SECRET = process.env.PUSH_DISPATCH_SECRET || "";

async function dispatchPush(request, payload) {
  const session = await getServerSession(authOptions);
  const providedSecret = request.headers.get("x-push-secret") || "";
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";

  if (
    !session?.user?.email &&
    !isVercelCron &&
    (!PUSH_DISPATCH_SECRET || providedSecret !== PUSH_DISPATCH_SECRET)
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!BACKEND_BASE_URL) {
    return Response.json({ error: "Backend URL is not configured" }, { status: 500 });
  }

  const body = payload || {};

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/push/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-push-secret": PUSH_DISPATCH_SECRET,
      },
      body: JSON.stringify({
        user_email: session?.user?.email || undefined,
        ...body,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json({ error: data?.detail || "Dispatch failed" }, { status: response.status });
    }

    return Response.json(data);
  } catch (error) {
    return Response.json(
      {
        error: "Unable to reach backend",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  return dispatchPush(request, body);
}

export async function GET(request) {
  return dispatchPush(request, {});
}