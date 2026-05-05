import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || "";

export async function POST(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!BACKEND_BASE_URL) {
    return Response.json({ error: "Backend URL is not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/tasks/delete-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_ids: body?.email_ids || [] }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return Response.json({ error: data?.detail || "Unable to delete tasks" }, { status: response.status });
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
