import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || "";

export async function DELETE(_request, context) {
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

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/tasks/${encodeURIComponent(emailId)}`, {
      method: "DELETE",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return Response.json({ error: data?.detail || "Unable to delete task" }, { status: response.status });
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
