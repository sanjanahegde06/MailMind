import base64
import calendar
import re
from datetime import date, timedelta
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from db import delete_task, get_all_tasks, save_task, set_task_done, task_exists
from rule_extractor import extract_batch, extract_deadline, is_actionable_task, is_promotional_email, is_task_noise

load_dotenv()

GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages"

MONTH_LOOKUP = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

WEEKDAY_LOOKUP = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

app = FastAPI(title="MailMind Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_bearer_token(authorization: str | None) -> str:
    if not authorization:
        return ""

    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return ""

    return parts[1].strip()


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _decode_gmail_body(data: str) -> str:
    if not data:
        return ""

    padding = "=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(data + padding).decode("utf-8", errors="ignore")
    except Exception:
        return ""


def _extract_text_from_payload(payload: dict[str, Any]) -> str:
    mime_type = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data", "")

    if mime_type == "text/plain" and body_data:
        return _decode_gmail_body(body_data)

    if body_data and mime_type.startswith("text/"):
        return _decode_gmail_body(body_data)

    for part in payload.get("parts", []) or []:
        if part.get("mimeType", "") == "text/plain":
            text = _decode_gmail_body(part.get("body", {}).get("data", ""))
            if text:
                return text

    for part in payload.get("parts", []) or []:
        nested = _extract_text_from_payload(part)
        if nested:
            return nested

    return ""


def _fetch_recent_email_ids_from_gmail(access_token: str, max_results: int) -> list[str]:
    list_params = {"maxResults": str(max_results)}

    list_response = requests.get(
        GMAIL_BASE,
        headers=_auth_headers(access_token),
        params=list_params,
        timeout=20,
    )
    list_response.raise_for_status()

    list_body = list_response.json()
    messages = list_body.get("messages", [])
    return [message.get("id", "") for message in messages if message.get("id")]


def _fetch_email_content_from_gmail(access_token: str, email_id: str) -> str:
    detail_response = requests.get(
        f"{GMAIL_BASE}/{email_id}",
        headers=_auth_headers(access_token),
        params={"format": "full"},
        timeout=20,
    )
    detail_response.raise_for_status()

    detail_body = detail_response.json()
    payload = detail_body.get("payload", {})
    text = _extract_text_from_payload(payload)
    return text or detail_body.get("snippet", "") or ""


def _normalize_priority(priority_value: str) -> str:
    value = (priority_value or "").strip().lower()
    if value.startswith("h"):
        return "High"
    if value.startswith("m"):
        return "Medium"
    return "Low"


def _parse_deadline_date(deadline_text: str, today: date) -> date | None:
    value = (deadline_text or "").strip().lower()
    if not value or value == "not mentioned":
        return None

    if re.search(r"\b(today|tonight|eod|end of day|before noon|by evening)\b", value, re.IGNORECASE):
        return today

    if re.search(r"\b(tomorrow|tommorow)\b", value, re.IGNORECASE):
        return today + timedelta(days=1)

    if re.search(r"\bthis week\b", value, re.IGNORECASE):
        return today + timedelta(days=max(0, 6 - today.weekday()))

    weekday_match = re.search(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", value, re.IGNORECASE)
    if weekday_match:
        target_weekday = WEEKDAY_LOOKUP[weekday_match.group(1).lower()]
        delta_days = (target_weekday - today.weekday()) % 7
        return today + timedelta(days=delta_days)

    day_month_match = re.search(
        r"\b(?P<day>\d{1,2})(?:st|nd|rd|th)?\s+(?P<month>jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b",
        value,
        re.IGNORECASE,
    )
    if day_month_match:
        month = MONTH_LOOKUP[day_month_match.group("month").lower()]
        day = int(day_month_match.group("day"))
        year = today.year
        _, max_day = calendar.monthrange(year, month)
        if day > max_day:
            return None

        parsed = date(year, month, day)
        if parsed < today:
            parsed = date(year + 1, month, day)
        return parsed

    month_day_match = re.search(
        r"\b(?P<month>jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?\b",
        value,
        re.IGNORECASE,
    )
    if month_day_match:
        month = MONTH_LOOKUP[month_day_match.group("month").lower()]
        day = int(month_day_match.group("day"))
        year = today.year
        _, max_day = calendar.monthrange(year, month)
        if day > max_day:
            return None

        parsed = date(year, month, day)
        if parsed < today:
            parsed = date(year + 1, month, day)
        return parsed

    numeric_match = re.search(r"\b(?P<first>\d{1,2})[/-](?P<second>\d{1,2})(?:[/-](?P<year>\d{2,4}))?\b", value)
    if numeric_match:
        first = int(numeric_match.group("first"))
        second = int(numeric_match.group("second"))
        parsed_year_raw = numeric_match.group("year")

        parsed_year = today.year
        if parsed_year_raw:
            parsed_year = int(parsed_year_raw)
            if parsed_year < 100:
                parsed_year += 2000

        month = first
        day = second
        if first > 12 and second <= 12:
            day = first
            month = second

        if not (1 <= month <= 12):
            return None

        _, max_day = calendar.monthrange(parsed_year, month)
        if day < 1 or day > max_day:
            return None

        parsed = date(parsed_year, month, day)
        if not parsed_year_raw and parsed < today:
            parsed = date(today.year + 1, month, day)
        return parsed

    return None


def _adjust_priority_for_deadline(priority_value: str, deadline_text: str) -> str:
    normalized = _normalize_priority(priority_value)
    if normalized == "High":
        return normalized

    parsed_deadline = _parse_deadline_date(deadline_text, date.today())
    if not parsed_deadline:
        return normalized

    days_until_due = (parsed_deadline - date.today()).days
    if days_until_due <= 2:
        return "High"

    if days_until_due <= 7 and normalized == "Low":
        return "Medium"

    return normalized


def _is_suspicious_deadline(deadline_text: str) -> bool:
    value = (deadline_text or "").strip().lower()
    if not value or value == "not mentioned":
        return False

    if _parse_deadline_date(value, date.today()) is not None:
        return False

    if re.search(
        r"\b\d{1,2}(?::\d{2})?\s?(?:am|pm)?\s*(?:to|-|–|—)\s*\d{1,2}(?::\d{2})?\s?(?:am|pm)?\b",
        value,
        re.IGNORECASE,
    ):
        return False

    if re.search(r"\b\d{1,2}:\d{2}\s?(?:am|pm)?\b", value, re.IGNORECASE):
        return False

    ampm_match = re.search(r"\b(?P<hour>\d{1,2})\s?(?:am|pm)\b", value, re.IGNORECASE)
    if ampm_match:
        try:
            hour = int(ampm_match.group("hour"))
        except ValueError:
            return True
        return not (1 <= hour <= 12)

    return True


def _deadline_specificity_score(deadline_text: str) -> int:
    value = (deadline_text or "").strip().lower()
    if not value or value == "not mentioned":
        return 0

    has_range = bool(
        re.search(
            r"\b\d{1,2}(?::\d{2})?\s?(?:am|pm)?\s*(?:to|-|–|—)\s*\d{1,2}(?::\d{2})?\s?(?:am|pm)?\b",
            value,
            re.IGNORECASE,
        )
    )
    has_time = has_range or bool(re.search(r"\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b", value, re.IGNORECASE))
    has_absolute_date = bool(
        re.search(
            r"\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b",
            value,
            re.IGNORECASE,
        )
        or re.search(
            r"\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}(?:st|nd|rd|th)?\b",
            value,
            re.IGNORECASE,
        )
        or re.search(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b", value, re.IGNORECASE)
    )
    has_weekday = bool(re.search(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", value, re.IGNORECASE))
    has_relative_date = bool(re.search(r"\b(today|tomorrow|tommorow|tonight|this week|next week)\b", value, re.IGNORECASE))

    if has_time and (has_absolute_date or has_weekday or has_relative_date):
        return 5
    if has_absolute_date and has_weekday:
        return 4
    if has_absolute_date:
        return 3
    if has_time:
        return 2
    if has_weekday or has_relative_date:
        return 1
    return 0


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "MailMind backend is running"}


@app.get("/process-emails")
def process_emails(
    max_results: int = Query(default=12, ge=1, le=20),
    batch_size: int = Query(default=5, ge=1, le=10),
    authorization: str | None = Header(default=None),
) -> dict[str, int | bool | str]:
    access_token = _parse_bearer_token(authorization)
    if not access_token:
        return {
            "requested": 0,
            "pending_new": 0,
            "processed_new": 0,
            "skipped_existing": 0,
            "failed": 0,
            "rate_limited": False,
            "message": "Missing Gmail access token. Please sign in again.",
        }

    try:
        email_ids = _fetch_recent_email_ids_from_gmail(access_token, max_results)
        emails = [{"email_id": email_id, "content": ""} for email_id in email_ids]
    except requests.RequestException:
        return {
            "requested": 0,
            "pending_new": 0,
            "processed_new": 0,
            "skipped_existing": 0,
            "failed": 0,
            "rate_limited": False,
            "message": "Failed to fetch Gmail emails. Please reconnect Google account.",
        }

    processed_new = 0
    skipped_existing = 0
    skipped_non_actionable = 0
    failed = 0
    rate_limited = False
    message = ""

    pending_new: list[dict[str, str]] = []

    for email in emails:
        email_id = email.get("email_id", "")

        if not email_id:
            continue

        if task_exists(email_id):
            skipped_existing += 1
            continue

        pending_new.append(email)

    for start in range(0, len(pending_new), batch_size):
        batch_ids = pending_new[start : start + batch_size]
        batch: list[dict[str, str]] = []

        for email in batch_ids:
            email_id = email.get("email_id", "")
            if not email_id:
                continue

            try:
                if access_token:
                    content = _fetch_email_content_from_gmail(access_token, email_id)
            except requests.RequestException:
                failed += 1
                continue

            batch.append({"email_id": email_id, "content": content})

        if not batch:
            continue

        try:
            extracted_items = extract_batch(batch)
        except Exception:
            failed += len(batch)
            continue

        extracted_by_email_id = {
            item["email_id"]: item for item in extracted_items if item.get("email_id")
        }

        for email in batch:
            email_id = email.get("email_id", "")
            extracted = extracted_by_email_id.get(email_id)
            if not extracted:
                skipped_non_actionable += 1
                continue

            inserted = save_task(
                email_id=email_id,
                task=extracted["task"],
                deadline=extracted["deadline"],
                priority=extracted["priority"],
            )

            if inserted:
                processed_new += 1
            else:
                skipped_existing += 1

    message = "Rule-based extractor active (no external AI calls)."

    result: dict[str, int | bool | str] = {
        "requested": len(emails),
        "pending_new": len(pending_new),
        "processed_new": processed_new,
        "skipped_existing": skipped_existing,
        "skipped_non_actionable": skipped_non_actionable,
        "failed": failed,
        "rate_limited": rate_limited,
    }

    if message:
        result["message"] = message

    return result


@app.get("/tasks")
def get_tasks() -> list[dict]:
    tasks = get_all_tasks()
    filtered: list[dict] = []

    for task in tasks:
        email_id = str(task.get("email_id", "")).strip()
        task_text = str(task.get("task", "")).strip()
        deadline_value = str(task.get("deadline", "")).strip()
        deadline = deadline_value.lower()
        priority = str(task.get("priority", "")).strip().lower()

        should_infer_deadline = deadline in {"", "not mentioned"} or _is_suspicious_deadline(deadline_value)
        if task_text:
            inferred_deadline = extract_deadline(task_text)
            if inferred_deadline and inferred_deadline.lower() != "not mentioned" and (
                should_infer_deadline
                or _deadline_specificity_score(inferred_deadline) > _deadline_specificity_score(deadline_value)
            ):
                task["deadline"] = inferred_deadline
                deadline = inferred_deadline.lower()

        task["priority"] = _adjust_priority_for_deadline(task.get("priority", "Low"), task.get("deadline", ""))
        priority = str(task["priority"]).strip().lower()

        if not re.match(r"^[a-f0-9]{10,}$", email_id, flags=re.IGNORECASE):
            continue

        if not task_text or task_text.lower() == "general task":
            continue

        if priority == "low" and deadline in {"", "not mentioned"} and not is_actionable_task(task_text):
            continue

        if any(token in task_text.lower() for token in ["offer", "discount", "newsletter", "unsubscribe"]):
            continue

        if is_task_noise(task_text):
            continue

        if is_promotional_email(task_text):
            continue

        if not is_actionable_task(task_text):
            continue

        filtered.append(task)

    return filtered


@app.patch("/tasks/{email_id}/done")
def update_task_done(email_id: str, done: bool = Query(default=True)) -> dict[str, str | bool]:
    if not email_id:
        raise HTTPException(status_code=400, detail="email_id is required")

    updated = set_task_done(email_id, done)
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")

    return {"email_id": email_id, "done": bool(done), "message": "Task updated"}


@app.delete("/tasks/{email_id}")
def remove_task(email_id: str) -> dict[str, str]:
    if not email_id:
        raise HTTPException(status_code=400, detail="email_id is required")

    deleted = delete_task(email_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")

    return {"email_id": email_id, "message": "Task deleted"}
