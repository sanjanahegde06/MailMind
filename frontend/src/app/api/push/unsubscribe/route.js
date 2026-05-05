import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL;

export async function DELETE(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/push/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_email: session.user.email,
        endpoint: body?.endpoint,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json({ error: data?.detail || "Unable to remove subscription" }, { status: response.status });
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
