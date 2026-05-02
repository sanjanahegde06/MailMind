function normalizeWhitespace(value = "") {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function stripHtmlTags(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function compactText(value = "") {
  return normalizeWhitespace(value)
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function splitIntoLines(value = "") {
  return compactText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitIntoSentences(value = "") {
  const normalized = compactText(value).replace(/\n+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const matches = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (matches || [normalized]).map((sentence) => sentence.trim()).filter(Boolean);
}

function uniqueValues(values = []) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function shorten(value = "", maxLength = 180) {
  const compact = compactText(value);
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength).trimEnd()}...`;
}

function isGreetingOrSignoff(value = "") {
  return /^(hi|hello|hey|dear|thanks|thank you|best|regards|cheers|sincerely|sent from)/i.test(value.trim());
}

function extractOverview(sentences = [], fallbackText = "") {
  const candidates = [];

  for (const sentence of sentences) {
    if (sentence.length < 18 || isGreetingOrSignoff(sentence)) {
      continue;
    }

    candidates.push(sentence);
    if (candidates.length >= 3) {
      break;
    }
  }

  if (candidates.length > 0) {
    return candidates.join(" ");
  }

  return shorten(fallbackText, 220);
}

function extractKeyPoints(lines = [], sentences = []) {
  const hints = /(important|update|note|please|review|confirm|reminder|attached|meeting|project|schedule|decision|summary|change|next step|follow up)/i;
  const candidates = [
    ...lines.filter((line) => hints.test(line) || /^[-*•]|^\d+[.)]/.test(line)),
    ...sentences.filter((sentence) => hints.test(sentence)),
  ];

  return uniqueValues(candidates.map((candidate) => shorten(candidate, 140))).slice(0, 4);
}

function extractDeadlines(text = "", sentences = []) {
  const deadlineHints = /(deadline|due|by|before|no later than|end of day|end of business|eod|cob|today|tomorrow|tonight|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i;
  const datePatterns = [
    /\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}(?:,\s*\d{4})?(?:\s+at\s+\d{1,2}(?::\d{2})?\s?(?:am|pm))?\b/gi,
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?(?:\s+at\s+\d{1,2}(?::\d{2})?\s?(?:am|pm))?\b/gi,
    /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi,
  ];

  const candidates = [];

  for (const sentence of sentences) {
    if (deadlineHints.test(sentence)) {
      candidates.push(shorten(sentence, 140));
    }
  }

  for (const pattern of datePatterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      candidates.push(shorten(match, 120));
    }
  }

  return uniqueValues(candidates).slice(0, 4);
}

function extractActionItems(lines = [], sentences = []) {
  const actionHints = /(please|need to|needs to|must|should|remember to|can you|could you|action item|follow up|reply|confirm|review|send|complete|update|approve|schedule|prepare|provide|join|book|share)/i;
  const candidates = [
    ...lines.filter((line) => actionHints.test(line)),
    ...sentences.filter((sentence) => actionHints.test(sentence)),
  ];

  return uniqueValues(candidates.map((candidate) => shorten(candidate, 140))).slice(0, 4);
}

function inferPriority(text = "", deadlines = [], actionItems = []) {
  const lowered = text.toLowerCase();

  if (/(urgent|asap|immediately|critical|high priority|time sensitive|blocking)/i.test(lowered)) {
    return "High";
  }

  if (deadlines.length >= 2 || (deadlines.length >= 1 && actionItems.length >= 2)) {
    return "High";
  }

  if (deadlines.length >= 1 || actionItems.length >= 1 || /(please|need to|should|review|confirm|reply|follow up)/i.test(lowered)) {
    return "Medium";
  }

  return "Low";
}

export function buildEmailSummary({ subject = "", snippet = "", bodyText = "", bodyHtml = "" } = {}) {
  const sourceText = compactText([subject, snippet, bodyText || stripHtmlTags(bodyHtml)].filter(Boolean).join("\n\n"));

  if (!sourceText || sourceText.length < 40) {
    return null;
  }

  const lines = splitIntoLines(sourceText);
  const sentences = splitIntoSentences(sourceText);
  const overview = extractOverview(sentences, sourceText);
  const keyPoints = extractKeyPoints(lines, sentences);
  const deadlines = extractDeadlines(sourceText, sentences);
  const actionItems = extractActionItems(lines, sentences);
  const priority = inferPriority(sourceText, deadlines, actionItems);

  if (!overview && keyPoints.length === 0 && deadlines.length === 0 && actionItems.length === 0) {
    return null;
  }

  return {
    overview,
    keyPoints,
    deadlines,
    actionItems,
    priority,
  };
}
