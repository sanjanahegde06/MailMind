import base64
import calendar
import json
import logging
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any

import google.generativeai as genai
import requests
from dotenv import load_dotenv
from fastapi import Body, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pywebpush import WebPushException, webpush

from db import (
    delete_task,
    delete_tasks_batch,
    get_all_tasks,
    get_all_tasks_for_user,
    get_tasks_for_dispatch,
    get_tasks_with_custom_reminders,
    is_push_event_sent,
    list_push_subscriptions,
    save_task,
    save_push_subscription,
    set_task_done,
    task_exists,
    update_task_last_notified,
    update_task_deadline,
    update_task_reminders,
    update_task_user_email,
    mark_push_event_sent,
    remove_push_subscription,
    remove_push_subscriptions_for_user,
)
from rule_extractor import (
    extract_batch,
    extract_deadline,
    is_actionable_task,
    is_marketing_cta_task,
    is_promotional_email,
    is_task_noise,
)

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mailmind")

GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash-latest").strip()
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@mailmind.app").strip()
PUSH_DISPATCH_SECRET = os.getenv("PUSH_DISPATCH_SECRET", "").strip()
PUSH_POLL_INTERVAL_SEC = int(os.getenv("PUSH_POLL_INTERVAL_SEC", "60"))
PUSH_REMINDER_GRACE_SEC = int(os.getenv("PUSH_REMINDER_GRACE_SEC", "600"))
PUSH_IMMEDIATE_GRACE_SEC = int(os.getenv("PUSH_IMMEDIATE_GRACE_SEC", "21600"))

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
    allow_origins=[origin.strip() for origin in os.getenv("BACKEND_ALLOWED_ORIGINS", "http://localhost:3000").split(",") if origin.strip()],
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


def _push_enabled() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _is_same_day(left: datetime, right: datetime) -> bool:
    return left.date() == right.date()


def _build_task_reminder_schedule(task: dict) -> list[dict[str, Any]]:
    if task.get("done"):
        return []

    schedule: list[dict[str, Any]] = []
    custom_reminders = task.get("custom_reminders") or []

    if custom_reminders:
        for reminder in custom_reminders:
            reminder_time = _parse_iso_datetime(str(reminder))
            if not reminder_time:
                continue
            schedule.append({
                "id": f"custom:{task.get('email_id')}:{reminder_time.isoformat()}",
                "time": reminder_time,
            })
        return schedule

    deadline_at = _parse_iso_datetime(str(task.get("deadline_at", "")).strip())
    if not deadline_at:
        return []

    created_at = _parse_iso_datetime(str(task.get("created_at", "")).strip())

    one_day = deadline_at - timedelta(days=1)
    one_hour = deadline_at - timedelta(hours=1)
    schedule.append({"id": f"default:day:{task.get('email_id')}:{one_day.isoformat()}", "time": one_day})
    schedule.append({"id": f"default:hour:{task.get('email_id')}:{one_hour.isoformat()}", "time": one_hour})

    if created_at and _is_same_day(created_at, deadline_at):
        schedule.append({"id": f"immediate:{task.get('email_id')}:{deadline_at.isoformat()}", "time": created_at})

    return schedule


def _build_task_notification_payload(task: dict, title: str, body: str, url: str) -> dict:
    return {
        "title": title,
        "body": body,
        "url": url,
        "tag": f"task:{task.get('email_id', '')}",
    }


def _format_time_for_timezone(value: datetime, timezone_name: str | None) -> str:
    if not timezone_name:
        return value.astimezone(timezone.utc).isoformat()
    try:
        zone = ZoneInfo(timezone_name)
    except Exception:
        return value.astimezone(timezone.utc).isoformat()
    return value.astimezone(zone).strftime("%b %d, %Y %I:%M %p %Z")


def _is_notification_worthy(task: dict) -> bool:
    priority = str(task.get("priority", "")).lower()
    if priority in {"high", "medium"}:
        return True

    text = f"{task.get('task', '')} {task.get('deadline', '')}".lower()
    keywords = ["urgent", "deadline", "meeting", "submit", "asap", "due", "today", "tomorrow"]
    return any(keyword in text for keyword in keywords)


def _send_web_push(subscription: dict, payload: dict) -> bool:
    if not _push_enabled():
        return False
    if not subscription:
        return False

    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=300,
        )
        return True
    except WebPushException as exc:
        status_code = getattr(exc.response, "status_code", None)
        if status_code in {404, 410}:
            endpoint = subscription.get("endpoint")
            if endpoint:
                remove_push_subscription(endpoint)
        return False


def _send_push_to_subscriptions(payload: dict, subscriptions: list[dict] | None = None) -> int:
    if not _push_enabled():
        return 0

    subs = subscriptions if subscriptions is not None else list_push_subscriptions()
    if not subs:
        return 0

    sent = 0
    for subscription in subs:
        if _send_web_push(subscription, payload):
            sent += 1
    return sent


def _send_due_task_reminders() -> None:
    if not _push_enabled():
        return

    subscriptions = list_push_subscriptions()
    if not subscriptions:
        return

    tasks = get_all_tasks()
    now = datetime.now(timezone.utc)

    for task in tasks:
        schedule = _build_task_reminder_schedule(task)
        for reminder in schedule:
            reminder_time: datetime = reminder["time"]
            grace_window = PUSH_IMMEDIATE_GRACE_SEC if reminder["id"].startswith("immediate:") else PUSH_REMINDER_GRACE_SEC
            if reminder_time > now:
                continue
            if (now - reminder_time).total_seconds() > grace_window:
                continue

            event_id = f"push:{reminder['id']}"
            if is_push_event_sent(event_id):
                continue

            task_title = str(task.get("task") or "Task reminder")
            deadline = str(task.get("deadline") or "Not specified")
            email_id = str(task.get("email_id") or "").strip()
            target_url = f"/dashboard/email/{email_id}" if email_id else "/tasks"
            payload = _build_task_notification_payload(
                task,
                "MailMind Task Reminder",
                f"Task: {task_title}\nDeadline: {deadline}",
                target_url,
            )

            if _send_push_to_subscriptions(payload, subscriptions) > 0:
                mark_push_event_sent(event_id)




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


def _fetch_email_detail_from_gmail(access_token: str, email_id: str) -> tuple[str, datetime | None]:
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
    internal_date = detail_body.get("internalDate")
    received_at = None
    if internal_date:
        try:
            received_at = datetime.fromtimestamp(int(internal_date) / 1000, tz=timezone.utc)
        except (TypeError, ValueError):
            received_at = None

    return text or detail_body.get("snippet", "") or "", received_at


def _fetch_user_email_from_gmail(access_token: str) -> str:
    profile_response = requests.get(
        f"{GMAIL_BASE}/profile",
        headers=_auth_headers(access_token),
        timeout=20,
    )
    profile_response.raise_for_status()
    profile_body = profile_response.json()
    return str(profile_body.get("emailAddress", "")).strip()


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

    if re.search(r"\bnext week\b", value, re.IGNORECASE):
        return today + timedelta(days=7)

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


def _default_time_for_deadline(value: str) -> time:
    lowered = (value or "").lower()
    if "before noon" in lowered:
        return time(11, 0)
    if "tonight" in lowered:
        return time(20, 0)
    if "by evening" in lowered:
        return time(18, 0)
    if "eod" in lowered or "end of day" in lowered:
        return time(17, 0)
    return time(17, 0)


def _parse_time_from_text(value: str) -> time | None:
    if not value:
        return None

    range_match = re.search(
        r"\b(?P<start>\d{1,2}(?::\d{2})?\s?(?:am|pm)?)\s*(?:to|-|–|—)\s*(?P<end>\d{1,2}(?::\d{2})?\s?(?:am|pm)?)\b",
        value,
        re.IGNORECASE,
    )
    time_target = range_match.group("end") if range_match else ""

    time_match = re.search(r"\b\d{1,2}:\d{2}\s?(?:am|pm)?\b", value, re.IGNORECASE)
    if not time_match:
        time_match = re.search(r"\b\d{1,2}\s?(?:am|pm)\b", value, re.IGNORECASE)

    raw_time = time_target or (time_match.group(0) if time_match else "")
    if not raw_time:
        if re.search(r"\b(noon)\b", value, re.IGNORECASE):
            return time(12, 0)
        if re.search(r"\b(midnight)\b", value, re.IGNORECASE):
            return time(0, 0)
        return None

    normalized = raw_time.strip().lower().replace(" ", "")
    ampm_match = re.search(r"(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?(?P<ampm>am|pm)?", normalized)
    if not ampm_match:
        return None

    hour = int(ampm_match.group("hour"))
    minute = int(ampm_match.group("minute") or 0)
    ampm = ampm_match.group("ampm")

    if ampm:
        if hour == 12:
            hour = 0
        if ampm == "pm":
            hour += 12

    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None

    return time(hour, minute)


def _compute_deadline_datetime(deadline_text: str, received_at: datetime | None) -> datetime | None:
    value = (deadline_text or "").strip()
    if not value or value.lower() == "not mentioned":
        return None

    base_dt = received_at or datetime.now(timezone.utc)
    base_date = base_dt.date()

    parsed_date = _parse_deadline_date(value, base_date)
    parsed_time = _parse_time_from_text(value)

    if not parsed_date and parsed_time:
        parsed_date = base_date

    if parsed_date and not parsed_time:
        parsed_time = _default_time_for_deadline(value)

    if not parsed_date or not parsed_time:
        return None

    return datetime.combine(parsed_date, parsed_time, tzinfo=timezone.utc)


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
    user_email: str | None = Header(default=None, alias="x-user-email"),
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

    user_email = (user_email or "").strip()
    if not user_email:
        try:
            user_email = _fetch_user_email_from_gmail(access_token)
        except requests.RequestException:
            return {
                "requested": 0,
                "pending_new": 0,
                "processed_new": 0,
                "skipped_existing": 0,
                "failed": 0,
                "rate_limited": False,
                "message": "Failed to identify Gmail user. Please reconnect Google account.",
            }

    if not user_email:
        return {
            "requested": 0,
            "pending_new": 0,
            "processed_new": 0,
            "skipped_existing": 0,
            "failed": 0,
            "rate_limited": False,
            "message": "Unable to resolve Gmail user email.",
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
            update_task_user_email(email_id, user_email)
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
                    content, received_at = _fetch_email_detail_from_gmail(access_token, email_id)
            except requests.RequestException:
                failed += 1
                continue

            batch.append({"email_id": email_id, "content": content, "received_at": received_at})

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

        received_by_email_id = {
            str(email.get("email_id", "")).strip(): email.get("received_at")
            for email in batch
            if email.get("email_id")
        }

        for email in batch:
            email_id = email.get("email_id", "")
            extracted = extracted_by_email_id.get(email_id)
            if not extracted:
                skipped_non_actionable += 1
                continue

            received_at = received_by_email_id.get(email_id)
            deadline_at = _compute_deadline_datetime(extracted.get("deadline", ""), received_at)

            inserted = save_task(
                email_id=email_id,
                user_email=user_email,
                task=extracted["task"],
                deadline=extracted["deadline"],
                priority=extracted["priority"],
                email_received_at=received_at,
                deadline_at=deadline_at,
            )

            if inserted:
                processed_new += 1
                event_id = f"push:new-email:{user_email}:{email_id}"
                if not is_push_event_sent(event_id):
                    task_title = str(extracted.get("task") or "New important email")
                    deadline_label = str(extracted.get("deadline") or "Not specified")
                    task_snapshot = {
                        "task": task_title,
                        "deadline": deadline_label,
                        "priority": extracted.get("priority", "Low"),
                    }
                    if _is_notification_worthy(task_snapshot):
                        payload = {
                            "title": "New Important Email",
                            "body": f"{task_title}\nDeadline: {deadline_label}",
                            "url": f"/dashboard/email/{email_id}",
                            "tag": event_id,
                        }
                        subscriptions = list_push_subscriptions(user_email)
                        if _send_push_to_subscriptions(payload, subscriptions) > 0:
                            mark_push_event_sent(event_id)
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
def get_tasks(user_email: str = Query(default="")) -> list[dict]:
    user_email = (user_email or "").strip()
    if not user_email:
        raise HTTPException(status_code=400, detail="user_email is required")

    tasks = get_all_tasks_for_user(user_email)
    filtered: list[dict] = []

    for task in tasks:
        email_id = str(task.get("email_id", "")).strip()
        task_text = str(task.get("task", "")).strip()
        deadline_value = str(task.get("deadline", "")).strip()
        deadline = deadline_value.lower()
        priority = str(task.get("priority", "")).strip().lower()
        deadline_at_raw = str(task.get("deadline_at", "")).strip()
        received_at_raw = str(task.get("email_received_at", "")).strip()

        deadline_at = None
        if deadline_at_raw:
            try:
                deadline_at = datetime.fromisoformat(deadline_at_raw)
            except ValueError:
                deadline_at = None

        received_at = None
        if received_at_raw:
            try:
                received_at = datetime.fromisoformat(received_at_raw)
            except ValueError:
                received_at = None

        if not received_at:
            created_at_raw = str(task.get("created_at", "")).strip()
            if created_at_raw:
                try:
                    received_at = datetime.fromisoformat(created_at_raw)
                except ValueError:
                    received_at = None

        if not deadline_at:
            computed_deadline_at = _compute_deadline_datetime(deadline_value, received_at)
            if computed_deadline_at:
                task["deadline_at"] = computed_deadline_at.isoformat()
                deadline_at = computed_deadline_at
                update_task_deadline(
                    email_id,
                    {
                        "deadline_at": computed_deadline_at,
                        "email_received_at": received_at,
                    },
                )

        should_infer_deadline = deadline in {"", "not mentioned"} or _is_suspicious_deadline(deadline_value)
        if task_text:
            inferred_deadline = extract_deadline(task_text)
            if inferred_deadline and inferred_deadline.lower() != "not mentioned" and (
                should_infer_deadline
                or _deadline_specificity_score(inferred_deadline) > _deadline_specificity_score(deadline_value)
            ):
                task["deadline"] = inferred_deadline
                deadline = inferred_deadline.lower()
                computed_deadline_at = _compute_deadline_datetime(inferred_deadline, received_at)
                if computed_deadline_at:
                    task["deadline_at"] = computed_deadline_at.isoformat()
                    update_task_deadline(
                        email_id,
                        {
                            "deadline_at": computed_deadline_at,
                            "deadline": inferred_deadline,
                            "email_received_at": received_at,
                        },
                    )

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

        if is_marketing_cta_task(task_text):
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


@app.patch("/tasks/{email_id}/reminders")
def update_task_custom_reminders(email_id: str, payload: dict = Body(...)) -> dict[str, Any]:
    if not email_id:
        raise HTTPException(status_code=400, detail="email_id is required")

    reminders = payload.get("reminders", []) if isinstance(payload, dict) else []
    if reminders is None:
        reminders = []

    if not isinstance(reminders, list) or any(not isinstance(item, str) for item in reminders):
        raise HTTPException(status_code=400, detail="reminders must be a list of ISO strings")

    updated = update_task_reminders(email_id, reminders)
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")

    return {"email_id": email_id, "reminders": reminders, "message": "Reminders updated"}


@app.get("/push/vapid-public-key")
def get_vapid_public_key() -> dict[str, str]:
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=404, detail="VAPID public key not configured")
    return {"publicKey": VAPID_PUBLIC_KEY}


@app.get("/push/status")
def get_push_status(user_email: str = Query(default="")) -> dict[str, Any]:
    if not user_email:
        raise HTTPException(status_code=400, detail="user_email is required")
    subscriptions = list_push_subscriptions(user_email)
    return {"enabled": len(subscriptions) > 0, "count": len(subscriptions)}


@app.post("/push/subscribe")
def subscribe_to_push(payload: dict = Body(...)) -> dict[str, Any]:
    user_email = str(payload.get("user_email", "")).strip()
    subscription = payload.get("subscription")

    if not user_email:
        raise HTTPException(status_code=400, detail="user_email is required")
    if not subscription or not isinstance(subscription, dict):
        raise HTTPException(status_code=400, detail="subscription is required")

    if not _push_enabled():
        raise HTTPException(status_code=503, detail="Push notifications are not configured")

    timezone_name = str(payload.get("timezone", "")).strip()
    saved = save_push_subscription(user_email, subscription, timezone_name or None)
    if not saved:
        raise HTTPException(status_code=400, detail="Invalid subscription payload")

    return {"enabled": True, "message": "Subscription saved"}


@app.delete("/push/subscribe")
def unsubscribe_from_push(payload: dict = Body(...)) -> dict[str, Any]:
    user_email = str(payload.get("user_email", "")).strip()
    endpoint = str(payload.get("endpoint", "")).strip()

    if endpoint:
        removed = remove_push_subscription(endpoint)
        return {"removed": bool(removed)}

    if not user_email:
        raise HTTPException(status_code=400, detail="user_email or endpoint is required")

    removed_count = remove_push_subscriptions_for_user(user_email)
    return {"removed": removed_count}


@app.post("/push/unsubscribe")
def unsubscribe_from_push_post(payload: dict = Body(...)) -> dict[str, Any]:
    return unsubscribe_from_push(payload)


@app.post("/push/test")
def push_test(payload: dict = Body(...)) -> dict[str, Any]:
    user_email = str(payload.get("user_email", "")).strip()
    if not user_email:
        raise HTTPException(status_code=400, detail="user_email is required")
    if not _push_enabled():
        raise HTTPException(status_code=503, detail="Push notifications are not configured")

    title = str(payload.get("title") or "MailMind Test")
    body = str(payload.get("body") or "Push notifications are working.")
    url = str(payload.get("url") or "/dashboard")

    subscriptions = list_push_subscriptions(user_email)
    if not subscriptions:
        return {"sent": 0, "message": "No subscriptions found"}

    payload_data = {"title": title, "body": body, "url": url, "tag": "mailmind-test"}
    sent = _send_push_to_subscriptions(payload_data, subscriptions)
    return {"sent": sent}


@app.post("/push/dispatch")
def push_dispatch(
    payload: dict = Body(default=None),
    push_secret: str | None = Header(default=None, alias="x-push-secret"),
) -> dict[str, Any]:
    if not PUSH_DISPATCH_SECRET or push_secret != PUSH_DISPATCH_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not _push_enabled():
        raise HTTPException(status_code=503, detail="Push notifications are not configured")

    payload = payload or {}
    user_email = str(payload.get("user_email", "")).strip()

    subscriptions = list_push_subscriptions(user_email) if user_email else list_push_subscriptions()
    if not subscriptions:
        return {"sent": 0, "message": "No subscriptions found"}

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=PUSH_REMINDER_GRACE_SEC // 60)
    window_end = now + timedelta(hours=24, minutes=PUSH_REMINDER_GRACE_SEC // 60)
    sent = 0

    subscriptions_by_user: dict[str, list[dict]] = {}
    for subscription in subscriptions:
        sub_user = str(subscription.get("user_email") or "").strip()
        if not sub_user:
            continue
        subscriptions_by_user.setdefault(sub_user, []).append(subscription)

    for sub_user, user_subscriptions in subscriptions_by_user.items():
        tasks = get_tasks_for_dispatch(window_start, window_end, sub_user)
        custom_tasks = get_tasks_with_custom_reminders(sub_user)
        if custom_tasks:
            seen = {str(task.get("email_id") or "").strip() for task in tasks}
            tasks.extend([task for task in custom_tasks if str(task.get("email_id") or "").strip() not in seen])

        for task in tasks:
            schedule = _build_task_reminder_schedule(task)
            for reminder in schedule:
                reminder_time: datetime = reminder["time"]
                grace_window = (
                    PUSH_IMMEDIATE_GRACE_SEC if reminder["id"].startswith("immediate:") else PUSH_REMINDER_GRACE_SEC
                )
                if reminder_time > now:
                    continue
                if (now - reminder_time).total_seconds() > grace_window:
                    continue

                event_id = f"push:{sub_user}:{reminder['id']}"
                if is_push_event_sent(event_id):
                    continue

                if not _is_notification_worthy(task):
                    continue

                task_title = str(task.get("task") or "Task reminder")
                deadline = str(task.get("deadline") or "Not specified")
                email_id = str(task.get("email_id") or "").strip()
                target_url = f"/dashboard/email/{email_id}" if email_id else "/tasks"
                delivered = 0
                for subscription in user_subscriptions:
                    local_deadline = _format_time_for_timezone(reminder_time, subscription.get("timezone"))
                    payload_data = _build_task_notification_payload(
                        task,
                        "MailMind Task Reminder",
                        f"Task: {task_title}\nDue: {local_deadline}",
                        target_url,
                    )
                    if _send_web_push(subscription, payload_data):
                        delivered += 1

                if delivered:
                    mark_push_event_sent(event_id)
                    update_task_last_notified(email_id, now)
                    sent += delivered

    return {"sent": sent}


def _build_fallback_summary(subject: str, body_text: str) -> dict:
    """Simple regex-based summary as fallback when Gemini fails."""
    
    def extract_overview(text: str) -> str:
        sentences = [s.strip() for s in re.split(r'[.!?]+', text) if s.strip()]
        if sentences:
            return sentences[0][:200]
        return subject[:200] if subject else "No overview available"
    
    def extract_key_points(text: str) -> list[str]:
        lines = text.split('\n')
        points = [line.strip() for line in lines if line.strip() and len(line.strip()) > 10]
        return points[:4]
    
    def extract_deadlines(text: str) -> list[str]:
        deadline_pattern = r'(deadline|due|by|before)[:\s]+([^\n.]+)'
        matches = re.findall(deadline_pattern, text, re.IGNORECASE)
        return [m[1].strip() for m in matches][:3]
    
    def extract_actions(text: str) -> list[str]:
        action_pattern = r'(please|need to|should|must|action)[:\s]+([^\n.]+)'
        matches = re.findall(action_pattern, text, re.IGNORECASE)
        return [m[1].strip() for m in matches][:3]
    
    combined_text = f"{subject}\n{body_text}"
    
    return {
        "overview": extract_overview(combined_text),
        "keyPoints": extract_key_points(body_text),
        "deadlines": extract_deadlines(combined_text),
        "actionItems": extract_actions(combined_text),
        "priority": "Medium"
    }


def _summarize_with_gemini(subject: str, body_text: str) -> dict | None:
    """Attempt to summarize email using Gemini API."""
    if not GEMINI_API_KEY:
        return None

    def _candidate_model_names() -> list[str]:
        discovered: list[str] = []
        try:
            for item in genai.list_models():
                methods = getattr(item, "supported_generation_methods", []) or []
                if "generateContent" not in methods:
                    continue
                name = str(getattr(item, "name", "")).strip()
                if name.startswith("models/"):
                    name = name.removeprefix("models/")
                if name:
                    discovered.append(name)
        except Exception as exc:
            logger.warning("Gemini model discovery failed: %s", exc)

        preferred = [
            GEMINI_MODEL,
            "gemini-1.5-flash-latest",
            "gemini-1.5-flash-8b-latest",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
        ]

        merged: list[str] = []
        for name in discovered + preferred:
            normalized = (name or "").strip().removeprefix("models/")
            if normalized and normalized not in merged:
                merged.append(normalized)
        return merged

    try:
        genai.configure(api_key=GEMINI_API_KEY)
        prompt = f"""Analyze the following email and provide a structured summary in strict JSON.

Subject: {subject}

Body:
{body_text}

Return ONLY valid JSON (no markdown, no extra text) with this exact structure:
{{
  "overview": "2-3 sentence summary",
  "keyPoints": ["point1", "point2", "point3"],
  "deadlines": ["deadline1", "deadline2"],
  "actionItems": ["action1", "action2"],
  "priority": "Low|Medium|High"
}}

If a section has no relevant information, use empty string for overview or empty array for lists."""

        for model_name in _candidate_model_names():
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"},
                )
                response_text = (getattr(response, "text", "") or "").strip()
                if not response_text:
                    continue

                if "```json" in response_text:
                    response_text = response_text.split("```json", 1)[1].split("```", 1)[0].strip()
                elif "```" in response_text:
                    response_text = response_text.split("```", 1)[1].split("```", 1)[0].strip()

                summary = json.loads(response_text)
                priority_value = str(summary.get("priority", "Medium")).strip().title()
                if priority_value not in {"Low", "Medium", "High"}:
                    priority_value = "Medium"

                return {
                    "overview": str(summary.get("overview", ""))[:300],
                    "keyPoints": [str(p)[:150] for p in (summary.get("keyPoints") or [])][:4],
                    "deadlines": [str(d)[:150] for d in (summary.get("deadlines") or [])][:3],
                    "actionItems": [str(a)[:150] for a in (summary.get("actionItems") or [])][:4],
                    "priority": priority_value,
                }
            except Exception as model_exc:
                logger.warning("Gemini summarization failed for model '%s': %s", model_name, model_exc)

        return None
    except Exception as exc:
        logger.warning("Gemini summarization initialization failed: %s", exc)
        return None


@app.post("/summarize-email")
def summarize_email(data: dict = Body(...)) -> dict:
    """Summarize an email using Gemini API with fallback to regex-based summary."""
    email_id = data.get("email_id", "").strip() if isinstance(data, dict) else ""
    subject = data.get("subject", "").strip() if isinstance(data, dict) else ""
    body_text = data.get("body_text", "").strip() if isinstance(data, dict) else ""

    if not email_id or not subject or not body_text:
        raise HTTPException(status_code=400, detail="email_id, subject, and body_text are required")
    
    # Try Gemini first
    gemini_summary = _summarize_with_gemini(subject, body_text)
    if gemini_summary:
        return {"summary": gemini_summary, "source": "gemini"}
    
    # Fall back to simple summary
    fallback_summary = _build_fallback_summary(subject, body_text)
    return {"summary": fallback_summary, "source": "fallback"}


def _classify_ai_error(message: str, status_code: int | None = None) -> str:
    message_lower = (message or "").lower()
    if status_code == 429 or "rate limit" in message_lower or "quota" in message_lower or "too many" in message_lower:
        return "rate_limit"
    if status_code in {401, 403} or "unauthorized" in message_lower or "invalid api key" in message_lower:
        return "auth"
    if "timeout" in message_lower or "timed out" in message_lower or "network" in message_lower:
        return "network"
    if "empty" in message_lower or "no reply" in message_lower:
        return "empty"
    return "unknown"


def _tone_guidelines(tone: str | None) -> str:
    tone_value = (tone or "Professional").strip().lower()
    if tone_value == "casual":
        return "Friendly and warm, conversational, but still respectful."
    if tone_value == "short":
        return "Very brief and direct, no extra context unless required."
    return "Professional, polite, and concise."


def _generate_with_groq(subject: str, body_text: str, tone: str | None = None) -> dict:
    """Attempt to generate a reply using Groq API (OpenAI-compatible format).

    Requires `GROQ_API_KEY` env var. Uses official Groq endpoint.
    Returns dict: { ok, reply, error_type, error_message, status_code }
    """
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if not groq_key:
        logger.info("[Groq] No API key found, skipping Groq")
        return {"ok": False, "reply": "", "error_type": "auth", "error_message": "Missing GROQ_API_KEY", "status_code": None}

    groq_url = "https://api.groq.com/openai/v1/chat/completions"
    model_name = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant").strip() or "llama-3.1-8b-instant"

    tone_hint = _tone_guidelines(tone)
    prompt = f"""Write an email reply based on the following message.

Tone guidelines: {tone_hint}
Keep it factual and do not invent details. Be helpful and relevant.

Subject: {subject}

Body:
{body_text}

Reply:"""

    try:
        logger.info("[Groq] Sending request...")
        res = requests.post(
            groq_url,
            headers={
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": "You are a helpful email reply assistant."},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 512,
                "temperature": 0.7,
            },
            timeout=20,
        )

        logger.info("[Groq] Response status: %s", res.status_code)
        if not res.ok:
            error_message = ""
            try:
                error_json = res.json()
                error_message = (
                    error_json.get("error", {}).get("message")
                    if isinstance(error_json, dict)
                    else ""
                ) or res.text
            except Exception:
                error_message = res.text

            error_message = (error_message or "Groq request failed").strip()
            return {
                "ok": False,
                "reply": "",
                "error_type": _classify_ai_error(error_message, res.status_code),
                "error_message": error_message,
                "status_code": res.status_code,
            }

        data = res.json()
        if isinstance(data, dict):
            choices = data.get("choices", [])
            if choices and isinstance(choices, list):
                choice = choices[0]
                message = choice.get("message", {})
                if isinstance(message, dict):
                    reply = message.get("content", "").strip()
                    if reply:
                        logger.info("[Groq] Success! Generated %s chars", len(reply))
                        return {"ok": True, "reply": reply, "error_type": "", "error_message": "", "status_code": res.status_code}

            reply = data.get("reply") or data.get("text") or data.get("generated_text")
            if reply:
                reply = str(reply).strip()
                logger.info("[Groq] Success (fallback)! Generated %s chars", len(reply))
                return {"ok": True, "reply": reply, "error_type": "", "error_message": "", "status_code": res.status_code}

        return {
            "ok": False,
            "reply": "",
            "error_type": "empty",
            "error_message": "Groq returned empty reply",
            "status_code": res.status_code,
        }
    except Exception as exc:
        error_message = str(exc) or "Groq request failed"
        return {
            "ok": False,
            "reply": "",
            "error_type": _classify_ai_error(error_message, None),
            "error_message": error_message,
            "status_code": None,
        }


def _generate_with_gemini_reply(subject: str, body_text: str, tone: str | None = None) -> dict:
    if not GEMINI_API_KEY:
        return {"ok": False, "reply": "", "error_type": "auth", "error_message": "Missing GEMINI_API_KEY", "status_code": None}

    try:
        genai.configure(api_key=GEMINI_API_KEY)
        tone_hint = _tone_guidelines(tone)
        prompt = f"""Write an email reply to the following message.
    Tone guidelines: {tone_hint}
    Keep it factual and avoid inventing information.

Subject: {subject}

Body:
{body_text}

Reply:"""

        # try candidate models
        for model in [GEMINI_MODEL, "gemini-1.5-flash-latest", "gemini-2.0-flash"]:
            try:
                m = genai.GenerativeModel(model)
                response = m.generate_content(prompt)
                response_text = (getattr(response, "text", "") or "").strip()
                if response_text:
                    if "```" in response_text:
                        response_text = response_text.split("```", 1)[1].rsplit("```", 1)[0].strip()
                    return {"ok": True, "reply": response_text, "error_type": "", "error_message": "", "status_code": None}
            except Exception as e:
                logger.warning("Gemini reply generation failed for %s: %s", model, e)

        return {"ok": False, "reply": "", "error_type": "empty", "error_message": "Gemini returned empty reply", "status_code": None}
    except Exception as exc:
        error_message = str(exc) or "Gemini generation failed"
        return {
            "ok": False,
            "reply": "",
            "error_type": _classify_ai_error(error_message, None),
            "error_message": error_message,
            "status_code": None,
        }


@app.post("/generate-reply")
def generate_reply(data: dict = Body(...)) -> dict:
    """Generate a reply using Groq first, then fall back to Gemini.

    Returns: { reply: str, source: 'groq'|'gemini' }
    """
    email_id = data.get("email_id", "").strip() if isinstance(data, dict) else ""
    subject = data.get("subject", "").strip() if isinstance(data, dict) else ""
    body_text = data.get("body_text", "").strip() if isinstance(data, dict) else ""
    tone = data.get("tone") if isinstance(data, dict) else None

    if not email_id or not subject or not body_text:
        raise HTTPException(status_code=400, detail="email_id, subject, and body_text are required")
    
    logger.info(f"[generate-reply] Starting for email {email_id}, tone={tone}")
    
    # Try Groq first
    logger.info("[generate-reply] Attempting Groq...")
    groq_result = _generate_with_groq(subject, body_text, tone)
    if groq_result.get("ok"):
        logger.info("[generate-reply] Groq succeeded!")
        return {"reply": groq_result["reply"], "source": "groq"}

    logger.warning(
        "[generate-reply] Groq failed: type=%s status=%s msg=%s",
        groq_result.get("error_type"),
        groq_result.get("status_code"),
        (groq_result.get("error_message") or "")[0:120],
    )

    logger.info("[generate-reply] Trying Gemini...")
    gemini_result = _generate_with_gemini_reply(subject, body_text, tone)
    if gemini_result.get("ok"):
        logger.info("[generate-reply] Gemini succeeded!")
        return {"reply": gemini_result["reply"], "source": "gemini"}

    logger.warning(
        "[generate-reply] Gemini failed: type=%s msg=%s",
        gemini_result.get("error_type"),
        (gemini_result.get("error_message") or "")[0:120],
    )

    both_rate_limited = groq_result.get("error_type") == "rate_limit" and gemini_result.get("error_type") == "rate_limit"
    if both_rate_limited:
        raise HTTPException(status_code=429, detail="Today's AI limit reached. Please try again later.")

    combined_error = "Groq: {g_type} ({g_msg}) | Gemini: {m_type} ({m_msg})".format(
        g_type=groq_result.get("error_type"),
        g_msg=(groq_result.get("error_message") or "Unknown error")[:140],
        m_type=gemini_result.get("error_type"),
        m_msg=(gemini_result.get("error_message") or "Unknown error")[:140],
    )
    raise HTTPException(status_code=502, detail=f"AI reply generation failed. {combined_error}")


@app.post("/send-reply")
def send_reply(data: dict = Body(...), authorization: str | None = Header(default=None)) -> dict:
    """Send a reply to an email via Gmail. Requires Authorization header with Gmail access token.

    Expects: { email_id: str, reply_text: str }
    """
    access_token = _parse_bearer_token(authorization)
    if not access_token:
        raise HTTPException(status_code=401, detail="Missing Gmail access token")

    email_id = data.get("email_id", "").strip() if isinstance(data, dict) else ""
    reply_text = data.get("reply_text", "").strip() if isinstance(data, dict) else ""

    if not email_id or not reply_text:
        raise HTTPException(status_code=400, detail="email_id and reply_text are required")

    try:
        # Fetch original message to obtain threadId and headers
        detail_res = requests.get(f"{GMAIL_BASE}/{email_id}", headers=_auth_headers(access_token), params={"format": "full"}, timeout=20)
        detail_res.raise_for_status()
        detail = detail_res.json()
        headers = detail.get("payload", {}).get("headers", []) or []
        thread_id = detail.get("threadId") or None

        def header_val(name: str) -> str:
            for h in headers:
                if h.get("name", "").lower() == name.lower():
                    return h.get("value", "")
            return ""

        original_from = header_val("from") or ""
        original_subject = header_val("subject") or ""
        message_id = header_val("message-id") or header_val("Message-ID")

        # Build simple plaintext reply with proper headers
        reply_subject = original_subject if original_subject.lower().startswith("re:") else f"Re: {original_subject}"

        raw_lines = []
        raw_lines.append(f"To: {original_from}")
        raw_lines.append(f"Subject: {reply_subject}")
        if message_id:
            raw_lines.append(f"In-Reply-To: {message_id}")
            raw_lines.append(f"References: {message_id}")
        raw_lines.append("MIME-Version: 1.0")
        raw_lines.append('Content-Type: text/plain; charset="UTF-8"')
        raw_lines.append("")
        raw_lines.append(reply_text)

        raw = "\r\n".join(raw_lines)
        raw_b64 = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").replace("=", "")

        post_payload = {"raw": raw_b64}
        if thread_id:
            post_payload["threadId"] = thread_id

        send_res = requests.post(
            f"{GMAIL_BASE}/send",
            headers=_auth_headers(access_token),
            json=post_payload,
            timeout=20,
        )

        if not send_res.ok:
            error_text = ""
            try:
                error_text = send_res.text[:500]
            except Exception:
                error_text = ""

            logger.warning(
                "Failed to send reply: status=%s body=%s",
                send_res.status_code,
                error_text,
            )
            raise HTTPException(
                status_code=send_res.status_code,
                detail=f"Failed to send reply: {send_res.status_code} {error_text}".strip(),
            )

        return {"message": "Reply sent successfully"}
    except requests.RequestException as exc:
        logger.warning("Failed to send reply request: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to send reply")


@app.delete("/tasks/{email_id}")
def remove_task(email_id: str) -> dict[str, str]:
    if not email_id:
        raise HTTPException(status_code=400, detail="email_id is required")

    deleted = delete_task(email_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")

    return {"email_id": email_id, "message": "Task deleted"}


@app.post("/tasks/delete-batch")
def remove_tasks_batch(payload: dict = Body(...)) -> dict[str, Any]:
    email_ids = payload.get("email_ids", []) if isinstance(payload, dict) else []
    if not isinstance(email_ids, list) or any(not isinstance(item, str) for item in email_ids):
        raise HTTPException(status_code=400, detail="email_ids must be a list of strings")

    normalized = [str(item).strip() for item in email_ids if str(item).strip()]
    if not normalized:
        return {"deleted": 0, "message": "No task ids provided"}

    deleted_count = delete_tasks_batch(normalized)
    return {"deleted": deleted_count, "message": "Tasks deleted"}
