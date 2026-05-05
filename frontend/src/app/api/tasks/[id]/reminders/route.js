import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || "";

export async function PATCH(request, context) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!BACKEND_BASE_URL) {
    return Response.json({ error: "Backend URL is not configured" }, { status: 500 });
  }

  const resolvedParams = await context.params;
  const rawId = resolvedParams?.id;
  const emailId = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!emailId) {
    return Response.json({ error: "Missing task id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/tasks/${encodeURIComponent(emailId)}/reminders`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reminders: body?.reminders || [] }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return Response.json({ error: data?.detail || "Unable to update reminders" }, { status: response.status });
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
