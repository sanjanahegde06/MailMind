import re
from typing import Iterable

TASK_KEYWORDS = [
    "submit", "send", "finish", "complete", "do", "prepare", "make",
    "review", "check", "look into", "verify", "update", "fix",
    "attend", "join", "be there", "hop on", "connect",
    "schedule", "arrange", "set up", "plan",
    "upload", "download", "share", "forward",
    "write", "draft", "create", "build", "implement",
    "analyze", "test", "run", "execute","test",
    "call", "email", "reply", "respond",
    "ping", "text", "drop", "send over",
    "wrap up", "finish up", "close",
    "start", "begin", "initiate",
    "choose", "select", "opt", "opt for",
    "complete asap", "do asap", "finish asap","meeting","scheduled at","webminar","workshop","exam","examination","assesment"
]

HIGH_PRIORITY_WORDS = ["urgent", "asap", "immediately", "right now", "important", "critical", "deadline", "before noon", "by evening", "eod", "end of day", "today", "tonight","As soon as possible"]
MEDIUM_PRIORITY_WORDS = ["soon", "this week", "next week", "by end of week", "before next week", "in the near future", "medium priority"]

PROMOTIONAL_KEYWORDS = [
    "unsubscribe",
    "view in browser",
    "privacy policy",
    "terms of service",
    "limited time",
    "offer",
    "offers",
    "discount",
    "sale",
    "promo",
    "promotion",
    "newsletter",
    "marketing",
    "campaign",
    "shop now",
    "buy now",
    "free trial",
    "welcome to",
    "explore resources",
    "create a cluster",
    "start building",
    "product update",
    "announcement",
]

REQUEST_CONTEXT_WORDS = [
    "please",
    "kindly",
    "can you",
    "could you",
    "need you",
    "need to",
    "you need to",
    "needed to",
    "required to",
    "must",
    "asap",
    "urgent",
    "deadline",
]

MARKETING_CTA_PATTERNS = [
    re.compile(r"\bjoin\b[^.\n]*\bconnect with\b[^.\n]*\bcommunity\b", re.IGNORECASE),
    re.compile(r"\bjoin\b[^.\n]*\bglobal community\b", re.IGNORECASE),
    re.compile(r"\b(sign up|subscribe|become a member|membership team|learn more)\b", re.IGNORECASE),
]

NOISE_TOKENS = [
    "tm_campaign",
    "utm_",
    "href=",
    "http://",
    "https://",
    "www.",
    "<a ",
    "</a>",
    "cloud.mongodb.com",
]

TIME_RANGE_PATTERN = re.compile(
    r"\b\d{1,2}(?::\d{2})?\s?(?:am|pm)?\s*(?:to|-|–|—)\s*\d{1,2}(?::\d{2})?\s?(?:am|pm)?\b",
    re.IGNORECASE,
)
TIME_COLON_PATTERN = re.compile(r"\b\d{1,2}:\d{2}\s?(?:am|pm)?\b", re.IGNORECASE)
TIME_AMPM_PATTERN = re.compile(r"(?<!:)\b\d{1,2}\s?(?:am|pm)\b", re.IGNORECASE)

DATE_PATTERNS = [
    re.compile(
        r"\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?:\s+\d{2,4})?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b", re.IGNORECASE),
    re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE),
    re.compile(
        r"\b(today|tomorrow|tommorow|tonight|next week|this week|eod|end of day|asap|before noon|by evening)\b",
        re.IGNORECASE,
    ),
]

_PREFIX_CLEANUP = [
    r"^please\s+",
    r"^kindly\s+",
    r"^(can you|could you|pls|pls\.|yo bro|hey|hi)\s+",
    r"^(let\'s|lets)\s+",
]

_SPLIT_RE = re.compile(r"[\n\r\.\!\?]+")


def _normalize_spaces(text: str) -> str:
    value = (text or "")
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"&[a-zA-Z0-9#]+;", " ", value)
    value = re.sub(r"https?://\S+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _clean_task_phrase(text: str) -> str:
    cleaned = _normalize_spaces(text)
    for pattern in _PREFIX_CLEANUP:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r"\b(thanks|thank you|regards|cheers)\b.*$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(tm_campaign|utm_[a-z_]+|view in browser|privacy policy)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip("-:;,. ")
    if len(cleaned) > 140:
        cleaned = cleaned[:140].rstrip() + "..."
    return cleaned or "General task"


def _sentence_priority_boost(sentence: str) -> int:
    lower = sentence.lower()
    score = 0
    if any(word in lower for word in HIGH_PRIORITY_WORDS):
        score += 20
    if any(word in lower for word in MEDIUM_PRIORITY_WORDS):
        score += 8
    return score


def _find_keyword_matches(sentence: str) -> Iterable[tuple[int, int, str]]:
    ordered = sorted(TASK_KEYWORDS, key=len, reverse=True)
    for keyword in ordered:
        pattern = re.compile(r"\b" + re.escape(keyword).replace(r"\ ", r"\s+") + r"\b", re.IGNORECASE)
        for match in pattern.finditer(sentence):
            yield match.start(), match.end() - match.start(), keyword


def _contains_task_keyword(text: str) -> bool:
    return next(_find_keyword_matches(text), None) is not None


def extract_task(email: str) -> str:
    text = _normalize_spaces(email)
    if not text:
        return "General task"

    sentences = [s.strip() for s in _SPLIT_RE.split(text) if s.strip()]
    if not sentences:
        return "General task"

    best = None
    best_score = -10**9

    for sentence_index, sentence in enumerate(sentences):
        for keyword_pos, keyword_len, _keyword in _find_keyword_matches(sentence):
            sentence_score = _sentence_priority_boost(sentence)
            # Earlier sentences and earlier keyword matches get preference.
            score = sentence_score - sentence_index * 3 - keyword_pos

            if score > best_score:
                start = max(0, keyword_pos - 20)
                candidate = sentence[start : keyword_pos + keyword_len + 80]
                best = _clean_task_phrase(candidate)
                best_score = score

    if best:
        return best

    # Fallback for conversational messages with no explicit verb match.
    casual_fallback = re.search(r"\b(done|once done|when done|need this|handle this|take care of this)\b", text, re.IGNORECASE)
    if casual_fallback:
        return "Follow up and complete the requested item"

    return "General task"


def extract_deadline(email: str) -> str:
    text = _normalize_spaces(email)

    date_value = ""
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue

        value = _normalize_spaces(match.group(0))
        if re.match(r"^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$", value):
            pieces = re.split(r"[/-]", value)
            try:
                first = int(pieces[0])
                second = int(pieces[1])
            except (ValueError, IndexError):
                continue

            if first > 31 or second > 31:
                continue

        date_value = value
        break

    time_match = TIME_RANGE_PATTERN.search(text) or TIME_COLON_PATTERN.search(text) or TIME_AMPM_PATTERN.search(text)
    time_value = _normalize_spaces(time_match.group(0)) if time_match else ""

    if date_value and time_value:
        return f"{date_value} at {time_value}"

    if date_value:
        return date_value

    if time_value:
        return time_value

    return "Not mentioned"


def extract_priority(email: str) -> str:
    if is_promotional_email(email):
        return "Low"

    text = (email or "").lower()

    has_task_context = any(word in text for word in REQUEST_CONTEXT_WORDS) or _contains_task_keyword(text)

    if has_task_context and any(word in text for word in HIGH_PRIORITY_WORDS):
        return "High"

    if has_task_context and re.search(r"\b(today|tonight|eod|end of day|before noon|right away)\b", text, re.IGNORECASE):
        return "High"

    if any(word in text for word in MEDIUM_PRIORITY_WORDS):
        return "Medium"

    if re.search(
        r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|\d{1,2}[/-]\d{1,2})\b",
        text,
        re.IGNORECASE,
    ):
        return "Medium"

    return "Low"


def extract_all(email: str) -> dict[str, str]:
    return {
        "task": extract_task(email),
        "deadline": extract_deadline(email),
        "priority": extract_priority(email),
    }


def is_promotional_email(email: str) -> bool:
    text = (email or "").lower()
    if any(token in text for token in NOISE_TOKENS):
        return True
    promo_hits = sum(1 for keyword in PROMOTIONAL_KEYWORDS if keyword in text)
    has_request_context = any(word in text for word in REQUEST_CONTEXT_WORDS)
    return promo_hits >= 2 and not has_request_context


def is_task_noise(task: str) -> bool:
    text = (task or "").lower().strip()
    if not text:
        return True

    if any(token in text for token in NOISE_TOKENS):
        return True

    if re.search(r"\b(unsubscribe|privacy policy|view in browser|terms of service)\b", text, re.IGNORECASE):
        return True

    alpha_words = re.findall(r"[a-zA-Z]{3,}", text)
    if len(alpha_words) < 3:
        return True

    return False


def is_marketing_cta_task(task: str) -> bool:
    text = (task or "").strip().lower()
    if not text:
        return False

    return any(pattern.search(text) for pattern in MARKETING_CTA_PATTERNS)


def is_actionable_task(task: str) -> bool:
    text = (task or "").strip().lower()
    if not text or text == "general task":
        return False
    if is_task_noise(text):
        return False
    if is_marketing_cta_task(text):
        return False
    return _contains_task_keyword(text) or "follow up" in text


def is_important_task(priority: str, deadline: str) -> bool:
    if priority in {"High", "Medium"}:
        return True
    if (deadline or "").strip().lower() != "not mentioned":
        return True
    return False


def has_request_intent(email: str, task: str, deadline: str, priority: str) -> bool:
    text = (email or "").lower()
    task_text = (task or "").lower()

    if any(word in text for word in REQUEST_CONTEXT_WORDS):
        return True

    if re.search(r"\b(please|kindly|can you|could you|need you to|you need to|need to|needed to|required to|must|should)\b", text, re.IGNORECASE):
        return True

    imperative = re.match(
        r"^(submit|send|finish|complete|prepare|review|check|verify|update|fix|attend|join|schedule|arrange|upload|share|write|draft|create|build|implement|analyze|test|run|call|email|reply|respond|ping|wrap up|start|begin|initiate|choose|select|opt)\b",
        task_text,
        re.IGNORECASE,
    )
    if imperative and (deadline.lower() != "not mentioned" or priority in {"High", "Medium"}):
        return True

    return False


def extract_batch(emails: list[dict[str, str]]) -> list[dict[str, str]]:
    extracted: list[dict[str, str]] = []
    for email in emails:
        email_id = str(email.get("email_id", "")).strip()
        if not email_id:
            continue

        content = str(email.get("content", ""))
        if is_promotional_email(content):
            continue

        record = extract_all(content)
        if not is_actionable_task(record["task"]):
            continue
        if not has_request_intent(content, record["task"], record["deadline"], record["priority"]) and record[
            "deadline"
        ].strip().lower() == "not mentioned":
            continue

        record["email_id"] = email_id
        extracted.append(record)

    return extracted
