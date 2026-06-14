# ============================================================
# Module: Usage Tracker (usage_tracker.py)
# 模块：Token 消耗记录器
#
# Records LLM token usage (including cache hits) into SQLite
# and provides aggregation APIs for frontend dashboards.
# 记录 LLM token 消耗（包含缓存命中）到 SQLite，为前端仪表板提供聚合 API。
# ============================================================

import os
import sqlite3
import logging
from datetime import datetime, timedelta

logger = logging.getLogger("ombre_brain.usage")

class UsageTracker:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, config: dict = None):
        if not hasattr(self, "initialized"):
            if config is None:
                from utils import load_config
                config = load_config()
            self.db_path = os.path.join(config.get("buckets_dir", "."), "usage.db")
            self._init_db()
            self.initialized = True

    def _init_db(self):
        """Create usage_logs table if not exists."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS usage_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                model TEXT NOT NULL,
                request_type TEXT NOT NULL,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cache_creation_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0
            )
        """)
        # Index for date-range queries
        conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_logs(timestamp)")
        conn.commit()
        conn.close()

    def log_usage(
        self,
        model: str,
        request_type: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_creation_tokens: int = 0,
        cache_read_tokens: int = 0,
    ):
        """
        Record a single API call's token usage.
        request_type: e.g., 'chat', 'dehydrate', 'dream_reflect', 'memory_merge'
        """
        try:
            from utils import now_iso
            timestamp = now_iso()
            
            conn = sqlite3.connect(self.db_path)
            conn.execute(
                """
                INSERT INTO usage_logs (
                    timestamp, model, request_type, 
                    input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    timestamp, model, request_type,
                    input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens
                )
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to log token usage: {e}")

    def get_daily_usage(self, days: int = 7) -> list[dict]:
        """
        Aggregate usage by day and request_type for the last N days.
        """
        start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        
        try:
            conn = sqlite3.connect(self.db_path)
            # Use SQLite substr to get 'YYYY-MM-DD' from ISO8601 timestamp
            rows = conn.execute("""
                SELECT 
                    substr(timestamp, 1, 10) as date,
                    request_type,
                    SUM(input_tokens) as total_input,
                    SUM(output_tokens) as total_output,
                    SUM(cache_creation_tokens) as total_cache_creation,
                    SUM(cache_read_tokens) as total_cache_read
                FROM usage_logs
                WHERE substr(timestamp, 1, 10) >= ?
                GROUP BY date, request_type
                ORDER BY date ASC
            """, (start_date,)).fetchall()
            conn.close()

            results = []
            for row in rows:
                results.append({
                    "date": row[0],
                    "request_type": row[1],
                    "input_tokens": row[2] or 0,
                    "output_tokens": row[3] or 0,
                    "cache_creation_tokens": row[4] or 0,
                    "cache_read_tokens": row[5] or 0,
                })
            return results
        except Exception as e:
            logger.error(f"Failed to retrieve daily usage: {e}")
            return []

    def get_savings_stats(self, days: int = 30) -> dict:
        """
        Calculate overall cache hit percentage and theoretical token savings.
        """
        start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        
        try:
            conn = sqlite3.connect(self.db_path)
            row = conn.execute("""
                SELECT 
                    SUM(input_tokens),
                    SUM(cache_creation_tokens),
                    SUM(cache_read_tokens)
                FROM usage_logs
                WHERE substr(timestamp, 1, 10) >= ?
            """, (start_date,)).fetchone()
            conn.close()

            input_toks = row[0] or 0
            cache_creation = row[1] or 0
            cache_read = row[2] or 0
            
            # Theoretical total input tokens if there was no caching
            # Usually: total_equivalent = input_toks + cache_read + cache_creation
            # Or depending on the API structure. For Anthropic, cache_read is tokens you DIDN'T pay full price for.
            total_input_represented = input_toks + cache_read
            
            hit_rate = 0.0
            if total_input_represented > 0:
                hit_rate = (cache_read / total_input_represented) * 100
                
            return {
                "period_days": days,
                "total_input_billed": input_toks,
                "total_cache_creation_billed": cache_creation,
                "total_cache_read": cache_read,
                "theoretical_total": total_input_represented,
                "cache_hit_rate_pct": round(hit_rate, 2)
            }
        except Exception as e:
            logger.error(f"Failed to calculate savings stats: {e}")
            return {}

# Singleton instance accessor
_tracker = None
def get_tracker() -> UsageTracker:
    global _tracker
    if _tracker is None:
        _tracker = UsageTracker()
    return _tracker
