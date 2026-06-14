import os
import json
import threading
from collections import defaultdict

# A dictionary to hold a lock for each absolute file path
_locks = defaultdict(threading.Lock)

def get_lock_for_path(path: str) -> threading.Lock:
    path = str(path)
    """Get the specific threading lock for a given file path."""
    abs_path = os.path.abspath(path)
    return _locks[abs_path]

def safe_write(path: str, content: str, encoding: str = "utf-8"):
    path = str(path)
    """
    Safely write string content to a file atomically.
    Uses a temporary file and os.replace to prevent corruption,
    and a thread lock to prevent race conditions.
    """
    lock = get_lock_for_path(path)
    with lock:
        # Ensure the directory exists
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "w", encoding=encoding) as f:
                f.write(content)
            # os.replace is atomic on POSIX and modern Windows
            os.replace(tmp_path, path)
        except Exception as e:
            # Clean up the temp file if something went wrong before replace
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise e

def safe_read(path: str, encoding: str = "utf-8") -> str:
    path = str(path)
    """Safely read string content from a file."""
    lock = get_lock_for_path(path)
    with lock:
        with open(path, "r", encoding=encoding) as f:
            return f.read()

def safe_write_json(path: str, data: dict, indent: int = 2, encoding: str = "utf-8"):
    """Safely write a dictionary to a JSON file atomically."""
    content = json.dumps(data, indent=indent, ensure_ascii=False)
    safe_write(path, content, encoding)

def safe_read_json(path: str, encoding: str = "utf-8", default=None):
    """
    Safely read a dictionary from a JSON file.
    If the file does not exist, returns `default` if provided, else raises FileNotFoundError.
    """
    lock = get_lock_for_path(path)
    with lock:
        try:
            with open(path, "r", encoding=encoding) as f:
                return json.load(f)
        except FileNotFoundError:
            if default is not None:
                return default
            raise
