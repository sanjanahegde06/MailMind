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

if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not configured. Add it to backend/.env")

mongo_client = MongoClient(MONGODB_URI)
database = mongo_client[MONGODB_DB]
tasks_collection: Collection = database[MONGODB_COLLECTION]

# High Priority: Ensure the unique index exists. 
# This is the "shield" that prevents duplicate email processing.
tasks_collection.create_index("email_id", unique=True)

def task_exists(email_id: str) -> bool:
    """
    Checks if a task exists in ANY state (done, active, or deleted).
    This tells main.py: 'We have already seen this email, don't process it again.'
    """
    return tasks_collection.find_one({"email_id": email_id}, {"_id": 1}) is not None

def save_task(email_id: str, task: str, deadline: str, priority: str) -> bool:
    """Saves a new task. If email_id exists, it fails (returning False)."""
    document = {
        "email_id": email_id,
        "task": task,
        "deadline": deadline,
        "priority": priority,
        "done": False,
        "is_deleted": False,  # New flag to support soft-deletion
        "done_at": None,
        "created_at": datetime.now(timezone.utc),
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
        results.append({
            "email_id": doc.get("email_id", ""),
            "task": doc.get("task", "No task"),
            "deadline": doc.get("deadline", "Not specified"),
            "priority": doc.get("priority", "Medium"),
            "done": bool(doc.get("done", False)),
            "done_at": doc.get("done_at").isoformat() if doc.get("done_at") else "",
            "created_at": created_at.isoformat() if created_at else "",
        })
    return results

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