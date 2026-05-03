import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const BACKEND_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

function getHeaderValue(headers = [], headerName) {
  return (
    headers.find((header) => header.name.toLowerCase() === headerName.toLowerCase())?.value ||
    ""
  );
}

function decodeBase64Url(value = "") {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${"=".repeat(4 - padding)}`;

  return Buffer.from(padded, "base64").toString("utf-8");
}

function findPart(parts = [], mimeType) {
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return part.body.data;
    }

    if (part.parts?.length) {
      const nested = findPart(part.parts, mimeType);
      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

function extractBody(payload = {}) {
  const htmlData = findPart(payload.parts, "text/html");
  if (htmlData) {
    return {
      bodyHtml: decodeBase64Url(htmlData),
      bodyText: "",
    };
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return {
      bodyHtml: decodeBase64Url(payload.body.data),
      bodyText: "",
    };
  }

  if (payload.body?.data) {
    return {
      bodyHtml: "",
      bodyText: decodeBase64Url(payload.body.data),
    };
  }

  const textData = findPart(payload.parts, "text/plain");
  if (textData) {
    return {
      bodyHtml: "",
      bodyText: decodeBase64Url(textData),
    };
  }

  return {
    bodyHtml: "",
    bodyText: "No readable email body found.",
  };
}

function stripHtmlTags(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

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
    const requestBody = await request.json().catch(() => ({}));
    const tone = typeof requestBody?.tone === "string" ? requestBody.tone : undefined;
    const detailRes = await fetch(
      `${GMAIL_BASE}/${encodeURIComponent(emailId)}?format=full&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
        cache: "no-store",
      },
    );

    if (!detailRes.ok) {
      const errText = await detailRes.text();
      return Response.json(
        { error: "Failed to fetch email", details: errText },
        { status: detailRes.status },
      );
    }

    const detailJson = await detailRes.json();
    const headers = detailJson.payload?.headers || [];
    const { bodyHtml, bodyText } = extractBody(detailJson.payload);
    const resolvedBodyText = bodyText || (bodyHtml ? stripHtmlTags(bodyHtml) : "") || "";
    const subject = getHeaderValue(headers, "subject") || "(No Subject)";

    // Call backend generator (Groq -> Gemini fallback)
    const genRes = await fetch(`${BACKEND_BASE}/generate-reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_id: emailId,
        subject,
        body_text: resolvedBodyText,
        tone,
      }),
      cache: "no-store",
    });

    if (!genRes.ok) {
      const errText = await genRes.text().catch(() => "Unknown error");
      return Response.json({ error: `Failed to generate reply: ${genRes.status} ${errText}` }, { status: genRes.status });
    }

    const genData = await genRes.json();
    return Response.json({ reply: genData.reply || "", source: genData.source || "unknown" });
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
