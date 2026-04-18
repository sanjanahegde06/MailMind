import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

function getAuthHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function getSubject(headers = []) {
  return (
    headers.find((header) => header.name.toLowerCase() === "subject")?.value ||
    "(No Subject)"
  );
}

function getHeaderValue(headers = [], headerName) {
  return (
    headers.find((header) => header.name.toLowerCase() === headerName.toLowerCase())?.value ||
    ""
  );
}

export async function GET(request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const pageToken = searchParams.get("pageToken") || "";
    const maxResultsRaw = Number(searchParams.get("maxResults") || "50");
    const maxResults = Number.isFinite(maxResultsRaw)
      ? Math.min(100, Math.max(1, Math.trunc(maxResultsRaw)))
      : 50;

    const listUrl = new URL(GMAIL_BASE);
    listUrl.searchParams.set("maxResults", String(maxResults));
    if (pageToken) {
      listUrl.searchParams.set("pageToken", pageToken);
    }

    const listRes = await fetch(listUrl.toString(), {
      headers: getAuthHeaders(session.accessToken),
      cache: "no-store",
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      return Response.json(
        { error: "Failed to fetch messages", details: errText },
        { status: listRes.status },
      );
    }

    const listJson = await listRes.json();
    const messages = listJson.messages ?? [];

    const emailResults = await Promise.all(
      messages.map(async (message) => {
        const detailRes = await fetch(
          `${GMAIL_BASE}/${message.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          {
            headers: getAuthHeaders(session.accessToken),
            cache: "no-store",
          },
        );

        if (!detailRes.ok) {
          return {
            id: message.id,
            subject: "(Unable to load subject)",
            snippet: "Could not load this email.",
          };
        }

        const detailJson = await detailRes.json();
        const headers = detailJson.payload?.headers || [];

        return {
          id: detailJson.id,
          subject: getSubject(headers),
          from: getHeaderValue(headers, "from") || "Unknown sender",
          date: getHeaderValue(headers, "date") || "",
          snippet: detailJson.snippet || "No preview available.",
        };
      }),
    );

    return Response.json({
      emails: emailResults,
      nextPageToken: listJson.nextPageToken || null,
      resultSizeEstimate: listJson.resultSizeEstimate || 0,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Unexpected server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
