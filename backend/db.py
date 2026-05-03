import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import DuplicateKeyError

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "mailmind")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "tasks")
MONGODB_PUSH_COLLECTION = os.getenv("MONGODB_PUSH_COLLECTION", "push_subscriptions")
MONGODB_PUSH_EVENTS_COLLECTION = os.getenv("MONGODB_PUSH_EVENTS_COLLECTION", "push_events")

if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not configured. Add it to backend/.env")

mongo_client = MongoClient(MONGODB_URI)
database = mongo_client[MONGODB_DB]
tasks_collection: Collection = database[MONGODB_COLLECTION]
push_collection: Collection = database[MONGODB_PUSH_COLLECTION]
push_events_collection: Collection = database[MONGODB_PUSH_EVENTS_COLLECTION]

# High Priority: Ensure the unique index exists. 
# This is the "shield" that prevents duplicate email processing.
tasks_collection.create_index("email_id", unique=True)
push_collection.create_index("endpoint", unique=True)
push_collection.create_index("user_email")
push_events_collection.create_index("event_id", unique=True)

def task_exists(email_id: str) -> bool:
    """
    Checks if a task exists in ANY state (done, active, or deleted).
    This tells main.py: 'We have already seen this email, don't process it again.'
    """
    return tasks_collection.find_one({"email_id": email_id}, {"_id": 1}) is not None

def save_task(
    email_id: str,
    task: str,
    deadline: str,
    priority: str,
    email_received_at: datetime | None,
    deadline_at: datetime | None,
    custom_reminders: list[str] | None = None,
) -> bool:
    """Saves a new task. If email_id exists, it fails (returning False)."""
    document = {
        "email_id": email_id,
        "task": task,
        "deadline": deadline,
        "deadline_at": deadline_at,
        "priority": priority,
        "done": False,
        "is_deleted": False,  # New flag to support soft-deletion
        "done_at": None,
        "created_at": datetime.now(timezone.utc),
        "email_received_at": email_received_at,
        "custom_reminders": custom_reminders or [],
        "last_notified_at": None,
    }

    try:
        tasks_collection.insert_one(document)
        return True
    except DuplicateKeyError:
        # This triggers if we try to save an email_id that is already in the DB
        return False

def get_all_tasks() -> list[dict]:
    """Fetches tasks that are NOT deleted."""
    # Filter: find documents where is_deleted is not True
    query = {"is_deleted": {"$ne": True}}
    docs = list(tasks_collection.find(query, {"_id": 0}).sort("created_at", -1))
    
    results = []
    for doc in docs:
        created_at = doc.get("created_at")
        deadline_at = doc.get("deadline_at")
        received_at = doc.get("email_received_at")
        last_notified_at = doc.get("last_notified_at")
        results.append({
            "email_id": doc.get("email_id", ""),
            "task": doc.get("task", "No task"),
            "deadline": doc.get("deadline", "Not specified"),
            "deadline_at": deadline_at.isoformat() if deadline_at else "",
            "priority": doc.get("priority", "Medium"),
            "done": bool(doc.get("done", False)),
            "done_at": doc.get("done_at").isoformat() if doc.get("done_at") else "",
            "created_at": created_at.isoformat() if created_at else "",
            "email_received_at": received_at.isoformat() if received_at else "",
            "custom_reminders": list(doc.get("custom_reminders") or []),
            "last_notified_at": last_notified_at.isoformat() if last_notified_at else "",
        })
    return results


def update_task_last_notified(email_id: str, when: datetime) -> bool:
    if not email_id:
        return False
    result = tasks_collection.update_one(
        {"email_id": email_id},
        {"$set": {"last_notified_at": when}},
    )
    return result.matched_count > 0


def update_task_deadline(email_id: str, updates: dict) -> bool:
    """Updates deadline-related metadata for a task."""
    if not email_id or not updates:
        return False

    result = tasks_collection.update_one({"email_id": email_id}, {"$set": updates})
    return result.matched_count > 0


def update_task_reminders(email_id: str, reminders: list[str]) -> bool:
    """Stores custom reminder times (ISO strings) for a task."""
    result = tasks_collection.update_one(
        {"email_id": email_id},
        {"$set": {"custom_reminders": reminders or []}},
    )
    return result.matched_count > 0


def delete_tasks_batch(email_ids: list[str]) -> int:
    """Soft-deletes multiple tasks by email_id."""
    if not email_ids:
        return 0

    result = tasks_collection.update_many(
        {"email_id": {"$in": email_ids}},
        {"$set": {"is_deleted": True}},
    )
    return int(result.modified_count or 0)

def set_task_done(email_id: str, done: bool) -> bool:
    """Marks a task as done without deleting it."""
    update = {
        "done": bool(done), 
        "done_at": datetime.now(timezone.utc) if done else None
    }
    result = tasks_collection.update_one({"email_id": email_id}, {"$set": update})
    return result.matched_count > 0

def delete_task(email_id: str) -> bool:
    """
    Soft-deletes the task. 
    The record stays in MongoDB to prevent the email from being re-processed,
    but it will no longer show up in get_all_tasks().
    """
    result = tasks_collection.update_one(
        {"email_id": email_id}, 
        {"$set": {"is_deleted": True}}
    )
    return result.matched_count > 0


def save_push_subscription(user_email: str, subscription: dict, timezone_name: str | None = None) -> bool:
    if not subscription or not isinstance(subscription, dict):
        return False

    endpoint = subscription.get("endpoint")
    keys = subscription.get("keys") or {}
    if not endpoint or not isinstance(endpoint, str):
        return False

    payload = {
        "endpoint": endpoint,
        "keys": {
            "p256dh": keys.get("p256dh"),
            "auth": keys.get("auth"),
        },
        "user_email": user_email or "",
        "timezone": timezone_name or "",
        "updated_at": datetime.now(timezone.utc),
    }

    result = push_collection.update_one(
        {"endpoint": endpoint},
        {"$set": payload, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return bool(result.acknowledged)


def remove_push_subscription(endpoint: str) -> bool:
    if not endpoint:
        return False
    result = push_collection.delete_one({"endpoint": endpoint})
    return result.deleted_count > 0


def remove_push_subscriptions_for_user(user_email: str) -> int:
    if not user_email:
        return 0
    result = push_collection.delete_many({"user_email": user_email})
    return int(result.deleted_count or 0)


def list_push_subscriptions(user_email: str | None = None) -> list[dict]:
    query = {"user_email": user_email} if user_email else {}
    docs = list(push_collection.find(query, {"_id": 0}))
    return docs


def is_push_event_sent(event_id: str) -> bool:
    if not event_id:
        return False
    return push_events_collection.find_one({"event_id": event_id}, {"_id": 1}) is not None


def mark_push_event_sent(event_id: str) -> None:
    if not event_id:
        return
    push_events_collection.update_one(
        {"event_id": event_id},
        {"$set": {"event_id": event_id, "sent_at": datetime.now(timezone.utc)}},
        upsert=True,
    )


def get_tasks_for_dispatch(window_start: datetime, window_end: datetime) -> list[dict]:
    query = {
        "is_deleted": {"$ne": True},
        "done": {"$ne": True},
        "deadline_at": {"$ne": None, "$gte": window_start, "$lte": window_end},
    }
    docs = list(tasks_collection.find(query, {"_id": 0}).sort("deadline_at", 1))
    results: list[dict] = []
    for doc in docs:
        created_at = doc.get("created_at")
        deadline_at = doc.get("deadline_at")
        received_at = doc.get("email_received_at")
        last_notified_at = doc.get("last_notified_at")
        results.append({
            "email_id": doc.get("email_id", ""),
            "task": doc.get("task", "No task"),
            "deadline": doc.get("deadline", "Not specified"),
            "deadline_at": deadline_at.isoformat() if deadline_at else "",
            "priority": doc.get("priority", "Medium"),
            "done": bool(doc.get("done", False)),
            "done_at": doc.get("done_at").isoformat() if doc.get("done_at") else "",
            "created_at": created_at.isoformat() if created_at else "",
            "email_received_at": received_at.isoformat() if received_at else "",
            "custom_reminders": list(doc.get("custom_reminders") or []),
            "last_notified_at": last_notified_at.isoformat() if last_notified_at else "",
        })
    return results


def get_tasks_with_custom_reminders() -> list[dict]:
    query = {
        "is_deleted": {"$ne": True},
        "done": {"$ne": True},
        "custom_reminders": {"$exists": True, "$ne": []},
    }
    docs = list(tasks_collection.find(query, {"_id": 0}).sort("deadline_at", 1))
    results: list[dict] = []
    for doc in docs:
        created_at = doc.get("created_at")
        deadline_at = doc.get("deadline_at")
        received_at = doc.get("email_received_at")
        last_notified_at = doc.get("last_notified_at")
        results.append({
            "email_id": doc.get("email_id", ""),
            "task": doc.get("task", "No task"),
            "deadline": doc.get("deadline", "Not specified"),
            "deadline_at": deadline_at.isoformat() if deadline_at else "",
            "priority": doc.get("priority", "Medium"),
            "done": bool(doc.get("done", False)),
            "done_at": doc.get("done_at").isoformat() if doc.get("done_at") else "",
            "created_at": created_at.isoformat() if created_at else "",
            "email_received_at": received_at.isoformat() if received_at else "",
            "custom_reminders": list(doc.get("custom_reminders") or []),
            "last_notified_at": last_notified_at.isoformat() if last_notified_at else "",
        })
    return results