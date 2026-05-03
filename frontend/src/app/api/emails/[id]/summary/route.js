import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const BACKEND_BASE = (process.env.BACKEND_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

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

function stripHtmlTags(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
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

export async function POST(_request, context) {
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

    // Call backend summarizer (Gemini with fallback)
    const summaryRes = await fetch(`${BACKEND_BASE}/summarize-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_id: emailId,
        subject,
        body_text: resolvedBodyText,
      }),
      cache: "no-store",
    });

    if (!summaryRes.ok) {
      const errorText = await summaryRes.text().catch(() => "Unknown error");
      return Response.json(
        { error: `Failed to generate summary: ${summaryRes.status} ${errorText}` },
        { status: summaryRes.status },
      );
    }

    const summaryData = await summaryRes.json();

    return Response.json({
      summary: summaryData.summary || null,
      source: summaryData.source || "unknown",
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

