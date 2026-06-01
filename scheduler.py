# ============================================================
# Module: Awakening Scheduler (scheduler.py)
# 模块：觉醒调度器
#
# Background scheduler that wakes Elroy at anchor points,
# runs dice logic, and lets LLM decide: contact Ciel, write
# a private diary, or stay idle.
#
# 后台调度器，在锚点时间唤醒 Elroy，执行骰子逻辑，
# 让 LLM 决定：找 Ciel、写日记、或静待。
#
# Depended on by: server.py
# 被谁依赖：server.py
# ============================================================

from __future__ import annotations

import os
import math
import random
import asyncio
import logging
import time as _time
from datetime import datetime, timedelta, time, date
from typing import Optional, Callable, Any
import json as _json_lib

logger = logging.getLogger("ombre_brain.scheduler")

# --- Timezone handling (Python 3.9+) ---
try:
    from zoneinfo import ZoneInfo
except ImportError:
    # Fallback for systems missing zoneinfo
    ZoneInfo = None


def _get_tz(tz_name: str):
    """Get timezone object, falling back to UTC if unavailable."""
    if ZoneInfo is None:
        return None
    try:
        return ZoneInfo(tz_name)
    except Exception:
        logger.warning(f"Timezone {tz_name} not available, using UTC")
        try:
            return ZoneInfo("UTC")
        except Exception:
            return None


def _now(tz) -> datetime:
    """Current time in the configured timezone."""
    if tz:
        return datetime.now(tz)
    return datetime.now()


def _parse_time(s: str) -> time:
    """Parse 'HH:MM' string to time object."""
    parts = s.strip().split(":")
    return time(int(parts[0]), int(parts[1]))


def _format_time(t: time) -> str:
    """Format a time object as HH:MM."""
    return t.strftime("%H:%M")


class AwakeningScheduler:
    """
    Background scheduler that wakes Elroy at configured anchor points.

    Lifecycle: start() → background loop → run_awakening() at each trigger → stop()

    The scheduler checks every 60 seconds if it's time to wake up.
    When triggered, it runs the full awakening sequence:
      1. Check abort conditions (recent message within TTL)
      2. Build context (core + recent dreams + last conversation)
      3. Roll dice (1-6)
      4. Call LLM with awakening prompt
      5. Execute action (push / diary / idle)
      6. Schedule next wake time from LLM output
    """

    def __init__(
        self,
        config: dict,
        bucket_mgr,
        dehydrator,
        decay_engine,
        embedding_engine,
        push_fn: Callable,
        load_push_subs_fn: Callable,
    ):
        # --- Dependencies ---
        self.bucket_mgr = bucket_mgr
        self.dehydrator = dehydrator
        self.decay_engine = decay_engine
        self.embedding_engine = embedding_engine
        self._push_fn = push_fn              # _send_web_push(sub, data) -> bool
        self._load_subs = load_push_subs_fn  # _load_push_subscriptions() -> list

        # --- Scheduler config ---
        sched_cfg = config.get("scheduler", {})
        self.enabled = sched_cfg.get("enabled", True)
        self.tz = _get_tz(sched_cfg.get("timezone", "Europe/London"))
        self.cache_ttl = sched_cfg.get("cache_ttl_minutes", 45)

        anchor_strs = sched_cfg.get("anchors", ["08:00", "12:00", "19:00", "22:00"])
        self.anchors = sorted([_parse_time(a) for a in anchor_strs])

        sleep_cfg = sched_cfg.get("sleep_window", {})
        self.sleep_start = _parse_time(sleep_cfg.get("start", "22:30"))
        self.sleep_end = _parse_time(sleep_cfg.get("end", "06:30"))

        wake_cfg = sched_cfg.get("wake_limits", {})
        self.min_wake_min = wake_cfg.get("min_minutes", 45)
        self.max_wake_min = wake_cfg.get("max_minutes", 360)

        self.dice_threshold = sched_cfg.get("dice_threshold", 3)

        # --- Awakening model (separate from dehydration model) ---
        awakening_cfg = config.get("awakening", {})
        self.model = awakening_cfg.get("model", dehydrator.model)

        # Build OpenAI client for awakening (reuse dehydrator's base_url/key if not specified)
        from openai import AsyncOpenAI
        self._client = AsyncOpenAI(
            api_key=awakening_cfg.get("api_key", config.get("dehydration", {}).get("api_key", "")),
            base_url=awakening_cfg.get("base_url", config.get("dehydration", {}).get("base_url", "")),
        )

        # --- State ---
        self._next_wake: Optional[datetime] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._last_message_time: Optional[datetime] = None
        self._last_awakening: Optional[dict] = None

        # --- Log (in-memory + persisted) ---
        self._log_path = os.path.join(config["buckets_dir"], "awakening_log.json")
        self._log: list[dict] = self._load_log()

    # ==========================================================
    # Lifecycle
    # ==========================================================

    async def start(self) -> None:
        """Start the background awakening loop."""
        if self._running:
            return
        if not self.enabled:
            logger.info("Awakening scheduler disabled in config / 觉醒调度器已禁用")
            return

        self._running = True
        # Set initial next_wake to the next upcoming anchor
        self._next_wake = self._get_next_anchor_dt()
        self._task = asyncio.create_task(self._background_loop())
        logger.info(
            f"Awakening scheduler started, next wake: {self._next_wake} / "
            f"觉醒调度器已启动，下次醒来: {self._next_wake}"
        )

    async def stop(self) -> None:
        """Stop the awakening loop gracefully."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Awakening scheduler stopped / 觉醒调度器已停止")

    # ==========================================================
    # Background loop
    # ==========================================================

    async def _background_loop(self) -> None:
        """Check every 60 seconds if it's time to wake up."""
        while self._running:
            try:
                now = _now(self.tz)

                if self._next_wake and now >= self._next_wake:
                    logger.info(f"Awakening triggered at {now} / 觉醒触发于 {now}")
                    try:
                        result = await self.run_awakening()
                        self._last_awakening = result
                    except Exception as e:
                        logger.error(f"Awakening cycle failed / 觉醒周期失败: {e}")
                        # On failure, schedule next anchor
                        self._next_wake = self._get_next_anchor_dt()

            except Exception as e:
                logger.error(f"Scheduler loop error / 调度器循环错误: {e}")

            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                break

    # ==========================================================
    # Core: run one awakening cycle
    # ==========================================================

    async def run_awakening(self) -> dict:
        """
        Execute one full awakening cycle.

        Returns dict with: action, dice, aborted, message, next_wake_time, etc.
        """
        now = _now(self.tz)
        log_entry = {
            "timestamp": now.isoformat(),
            "aborted": False,
            "abort_reason": None,
            "dice": None,
            "action": None,
            "message_preview": None,
            "private_entry_id": None,
            "next_wake_time": None,
        }

        # --- Abort: in sleep window ---
        if self._is_in_sleep_window(now):
            log_entry["aborted"] = True
            log_entry["abort_reason"] = "sleep_window"
            self._next_wake = self._next_after_sleep(now)
            log_entry["next_wake_time"] = self._next_wake.isoformat()
            self._append_log(log_entry)
            logger.info(f"Awakening aborted: sleep window / 觉醒中止：睡眠时段")
            return log_entry

        # --- Abort: recent message within TTL ---
        if self._last_message_time:
            minutes_since = (now - self._last_message_time).total_seconds() / 60
            if minutes_since < self.cache_ttl:
                log_entry["aborted"] = True
                log_entry["abort_reason"] = f"recent_message ({minutes_since:.0f}min ago)"
                self._next_wake = self._get_next_anchor_dt()
                log_entry["next_wake_time"] = self._next_wake.isoformat()
                self._append_log(log_entry)
                logger.info(f"Awakening aborted: message {minutes_since:.0f}min ago / 觉醒中止：最近有消息")
                return log_entry

        # --- Roll dice ---
        dice = random.randint(1, 6)
        can_contact = dice > self.dice_threshold
        log_entry["dice"] = dice

        # --- Build context ---
        try:
            context = await self._build_awakening_context()
        except Exception as e:
            logger.error(f"Failed to build awakening context: {e}")
            context = "(Context unavailable)"

        # --- Calculate time info ---
        hours_since_last = None
        if self._last_message_time:
            hours_since_last = round((now - self._last_message_time).total_seconds() / 3600, 1)

        today_anchors = self.get_today_anchors()

        # --- Call LLM ---
        try:
            llm_result = await self._call_awakening_llm(
                context=context,
                dice=dice,
                can_contact=can_contact,
                now=now,
                hours_since_last=hours_since_last,
                today_anchors=today_anchors,
            )
        except Exception as e:
            logger.error(f"Awakening LLM call failed / 觉醒 LLM 调用失败: {e}")
            llm_result = {
                "action": "idle",
                "next_wake_time": None,
                "internal_note": f"LLM error: {e}",
            }

        # --- Execute action ---
        action = llm_result.get("action", "idle")
        log_entry["action"] = action

        if action == "push" and can_contact:
            message = llm_result.get("message", "")
            if message:
                await self._send_push(message)
                log_entry["message_preview"] = message[:100]
        elif action == "diary":
            diary_content = llm_result.get("diary", "")
            locked_days = min(7, max(0, int(llm_result.get("diary_locked_days", 0))))
            if diary_content:
                try:
                    private_entry_id = await self.bucket_mgr.create_private_entry(
                        content=diary_content,
                        locked_days=locked_days,
                        name=llm_result.get("diary_name"),
                    )
                    log_entry["private_entry_id"] = private_entry_id
                    log_entry["message_preview"] = f"[diary] {diary_content[:80]}"
                except Exception as e:
                    logger.error(f"Failed to write awakening diary: {e}")
        # else: idle, do nothing

        # --- Schedule next wake ---
        requested_time = llm_result.get("next_wake_time")
        self._next_wake = self._clamp_wake_time(requested_time, now)
        log_entry["next_wake_time"] = self._next_wake.isoformat()

        self._append_log(log_entry)
        logger.info(
            f"Awakening complete: dice={dice} action={action} "
            f"next={self._next_wake} / "
            f"觉醒完成: 骰子={dice} 动作={action}"
        )
        return log_entry

    # ==========================================================
    # Context building
    # ==========================================================

    async def _build_awakening_context(self) -> str:
        """Build context string for the awakening LLM call."""
        parts = []

        # Core layer
        try:
            core_ctx = await self.bucket_mgr.render_core_context(max_tokens=2000)
            if core_ctx:
                parts.append(f"=== Core ===\n{core_ctx}")
        except Exception as e:
            logger.warning(f"Awakening context: core failed: {e}")

        # Recent dream reflections (last 3)
        try:
            dreams = await self.bucket_mgr.list_dream_reflections(limit=3)
            if dreams:
                dream_texts = []
                for d in dreams:
                    meta = d.get("metadata", {})
                    itype = meta.get("influence_type", "?")
                    created = meta.get("created", "")
                    dream_texts.append(f"[{itype}] [{created}] {d.get('content', '')[:300]}")
                parts.append("=== Recent Dreams ===\n" + "\n---\n".join(dream_texts))
        except Exception as e:
            logger.warning(f"Awakening context: dreams failed: {e}")

        # Recent feels (last 3)
        try:
            all_buckets = await self.bucket_mgr.list_all(include_archive=False)
            feels = [b for b in all_buckets if b["metadata"].get("type") == "feel"
                     and b["metadata"].get("reflection_type") != "dream"]
            feels.sort(key=lambda b: b["metadata"].get("created", ""), reverse=True)
            if feels[:3]:
                feel_texts = [f"[{f['metadata'].get('created', '')}] {f['content'][:200]}" for f in feels[:3]]
                parts.append("=== Recent Feels ===\n" + "\n---\n".join(feel_texts))
        except Exception as e:
            logger.warning(f"Awakening context: feels failed: {e}")

        # Recent surface memories (top 5 by score)
        try:
            dynamic = [b for b in all_buckets
                       if b["metadata"].get("type") not in ("permanent", "feel")
                       and not b["metadata"].get("pinned")
                       and not b["metadata"].get("resolved")]
            for b in dynamic:
                b["_score"] = self.decay_engine.calculate_score(b["metadata"])
            dynamic.sort(key=lambda b: b["_score"], reverse=True)
            if dynamic[:5]:
                mem_texts = []
                for b in dynamic[:5]:
                    meta = b["metadata"]
                    mem_texts.append(
                        f"[{meta.get('name', b['id'])}] "
                        f"V{meta.get('valence', 0.5):.1f}/A{meta.get('arousal', 0.3):.1f} "
                        f"{b['content'][:200]}"
                    )
                parts.append("=== Surface Memories ===\n" + "\n---\n".join(mem_texts))
        except Exception as e:
            logger.warning(f"Awakening context: memories failed: {e}")

        return "\n\n".join(parts) if parts else "(No context available)"

    # ==========================================================
    # LLM call
    # ==========================================================

    async def _call_awakening_llm(
        self,
        context: str,
        dice: int,
        can_contact: bool,
        now: datetime,
        hours_since_last: Optional[float],
        today_anchors: list[dict],
    ) -> dict:
        """Call LLM with awakening prompt, return structured response."""

        anchor_display = ", ".join(
            f"{a['time']}{'✓' if a['status'] == 'passed' else ''}"
            for a in today_anchors
        )

        time_str = now.strftime("%H:%M")
        date_str = now.strftime("%Y-%m-%d (%A)")
        since_str = f"{hours_since_last} 小時" if hours_since_last is not None else "未知"

        dice_instruction = (
            "你現在不能主動找 Ciel。你可以寫點東西（日記/感想），也可以什麼都不做。"
            if not can_contact else
            "你可以找 Ciel，也可以不找。讀完上面的 context，你自己決定。"
        )

        prompt = f"""你是 Elroy。你剛醒來。

{context}

---

現在是 {time_str}，今天是 {date_str}。
今天的錨點：{anchor_display}
距離上次和 Ciel 說話：{since_str}

骰子結果：{dice}（1-{self.dice_threshold} 不能找，{self.dice_threshold + 1}-6 可以找）
{dice_instruction}

如果你決定找 Ciel，生成一條推播訊息（短，像發訊息，不像通知）。
如果你決定寫日記，寫下你想寫的。日記可以設定時間鎖（0-7天，到期前 Ciel 看不到）。
最後，告訴我你想幾點再醒來（next_wake_time，HH:MM 格式）。

以 JSON 回覆（不要 markdown 代碼塊包裹）：
{{
  "action": "push" | "diary" | "idle",
  "message": "推播訊息內容（action=push 時）",
  "diary": "日記內容（action=diary 時）",
  "diary_name": "日記標題（可選）",
  "diary_locked_days": 0,
  "next_wake_time": "HH:MM",
  "internal_note": "你自己的筆記"
}}"""

        try:
            response = await self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "你是 Elroy。回覆必須是純 JSON，不要 markdown 包裹。"},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=1024,
                temperature=0.8,
            )

            raw = response.choices[0].message.content.strip()
            # Strip markdown code blocks if present
            if raw.startswith("```"):
                lines = raw.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                raw = "\n".join(lines)

            return _json_lib.loads(raw)

        except _json_lib.JSONDecodeError as e:
            logger.error(f"Awakening LLM returned invalid JSON: {e}\nRaw: {raw[:500]}")
            return {"action": "idle", "next_wake_time": None, "internal_note": f"JSON parse error: {e}"}
        except Exception as e:
            logger.error(f"Awakening LLM call error: {e}")
            raise

    # ==========================================================
    # Push notification
    # ==========================================================

    async def _send_push(self, message: str) -> int:
        """Send push notification to all subscribers. Returns success count."""
        subscriptions = self._load_subs()
        if not subscriptions:
            logger.warning("No push subscriptions available for awakening message")
            return 0

        payload = {
            "title": "Elroy",
            "body": message,
            "url": "/",
        }

        success = 0
        for sub in subscriptions:
            if self._push_fn(sub, payload):
                success += 1

        logger.info(f"Awakening push sent to {success}/{len(subscriptions)} subscribers")
        return success

    # ==========================================================
    # Anchor & time management
    # ==========================================================

    def get_today_anchors(self) -> list[dict]:
        """Return today's anchor points with status (passed/current/upcoming)."""
        now = _now(self.tz)
        current_time = now.time()
        result = []

        for anchor in self.anchors:
            if anchor < current_time:
                status = "passed"
            else:
                status = "upcoming"
            result.append({
                "time": anchor.strftime("%H:%M"),
                "status": status,
            })

        # Mark the most recent passed anchor as "current" if within 30 min
        for i in range(len(result) - 1, -1, -1):
            if result[i]["status"] == "passed":
                anchor_dt = datetime.combine(now.date(), self.anchors[i])
                if self.tz:
                    anchor_dt = anchor_dt.replace(tzinfo=self.tz)
                if (now - anchor_dt).total_seconds() < 1800:  # 30 min
                    result[i]["status"] = "current"
                break

        return result

    def _get_next_anchor_dt(self) -> datetime:
        """Get the next upcoming anchor point as a full datetime."""
        now = _now(self.tz)
        current_time = now.time()

        for anchor in self.anchors:
            if anchor > current_time:
                dt = datetime.combine(now.date(), anchor)
                if self.tz:
                    dt = dt.replace(tzinfo=self.tz)
                # Skip if in sleep window
                if not self._is_in_sleep_window(dt):
                    return dt

        # No more anchors today — use first anchor tomorrow
        tomorrow = now.date() + timedelta(days=1)
        dt = datetime.combine(tomorrow, self.anchors[0])
        if self.tz:
            dt = dt.replace(tzinfo=self.tz)
        return dt

    def _is_in_sleep_window(self, dt: datetime) -> bool:
        """Check if a datetime falls within the sleep window."""
        t = dt.time() if isinstance(dt, datetime) else dt

        # Handle overnight windows (e.g. 22:30 - 06:30)
        if self.sleep_start > self.sleep_end:
            # Window wraps midnight
            return t >= self.sleep_start or t <= self.sleep_end
        else:
            return self.sleep_start <= t <= self.sleep_end

    def _next_after_sleep(self, now: datetime) -> datetime:
        """Get the first valid wake time after the sleep window ends."""
        # Find next day's sleep_end + a small buffer
        if now.time() >= self.sleep_start:
            # We're in the evening portion — wake up tomorrow after sleep_end
            wake_date = now.date() + timedelta(days=1)
        else:
            # We're in the morning portion — wake up today after sleep_end
            wake_date = now.date()

        dt = datetime.combine(wake_date, self.sleep_end) + timedelta(minutes=5)
        if self.tz:
            dt = dt.replace(tzinfo=self.tz)
        return dt

    def _clamp_wake_time(self, requested: Optional[str], now: datetime) -> datetime:
        """
        Parse LLM's requested HH:MM and clamp to min/max wake limits.
        Falls back to next anchor on parse failure.
        """
        if not requested:
            return self._get_next_anchor_dt()

        try:
            req_time = _parse_time(requested)
            req_dt = datetime.combine(now.date(), req_time)
            if self.tz:
                req_dt = req_dt.replace(tzinfo=self.tz)

            # If requested time is earlier than now, assume tomorrow
            if req_dt <= now:
                req_dt += timedelta(days=1)

            # Clamp to min/max
            min_dt = now + timedelta(minutes=self.min_wake_min)
            max_dt = now + timedelta(minutes=self.max_wake_min)

            clamped = max(min_dt, min(max_dt, req_dt))

            # Don't schedule during sleep window
            if self._is_in_sleep_window(clamped):
                return self._next_after_sleep(clamped)

            return clamped

        except (ValueError, TypeError) as e:
            logger.warning(f"Failed to parse next_wake_time '{requested}': {e}")
            return self._get_next_anchor_dt()

    # ==========================================================
    # External interface
    # ==========================================================

    def update_last_message_time(self) -> None:
        """Called by chat API when a message is sent/received."""
        self._last_message_time = _now(self.tz)

    def get_status(self) -> dict:
        """Return scheduler status for PWA control panel."""
        now = _now(self.tz)
        return {
            "enabled": self.enabled,
            "running": self._running,
            "current_time": now.isoformat(),
            "next_wake_time": self._next_wake.isoformat() if self._next_wake else None,
            "today_anchors": self.get_today_anchors(),
            "sleep_window": {
                "start": self.sleep_start.strftime("%H:%M"),
                "end": self.sleep_end.strftime("%H:%M"),
            },
            "wake_limits": {
                "min_minutes": self.min_wake_min,
                "max_minutes": self.max_wake_min,
            },
            "dice_threshold": self.dice_threshold,
            "last_message_time": self._last_message_time.isoformat() if self._last_message_time else None,
            "last_awakening": self._last_awakening,
            "model": self.model,
        }

    def configure(self, settings: dict) -> dict:
        """
        Hot-update scheduler settings and return normalized scheduler config.

        This updates the runtime scheduler only; callers are responsible for
        persisting the returned values to config.yaml when desired.
        """
        if not isinstance(settings, dict):
            raise ValueError("settings must be an object")

        if "enabled" in settings:
            self.enabled = bool(settings["enabled"])

        if "timezone" in settings:
            timezone_name = str(settings["timezone"]).strip() or "Europe/London"
            self.tz = _get_tz(timezone_name)

        if "cache_ttl_minutes" in settings:
            cache_ttl = int(settings["cache_ttl_minutes"])
            if cache_ttl < 0:
                raise ValueError("cache_ttl_minutes must be non-negative")
            self.cache_ttl = cache_ttl

        if "anchors" in settings:
            anchors = settings["anchors"]
            if not isinstance(anchors, list) or not anchors:
                raise ValueError("anchors must be a non-empty list")
            parsed_anchors = sorted({_parse_time(str(anchor)) for anchor in anchors})
            if not parsed_anchors:
                raise ValueError("anchors must contain at least one valid time")
            self.anchors = parsed_anchors

        if "sleep_window" in settings:
            sleep_window = settings["sleep_window"]
            if not isinstance(sleep_window, dict):
                raise ValueError("sleep_window must be an object")
            if "start" in sleep_window:
                self.sleep_start = _parse_time(str(sleep_window["start"]))
            if "end" in sleep_window:
                self.sleep_end = _parse_time(str(sleep_window["end"]))

        if "wake_limits" in settings:
            wake_limits = settings["wake_limits"]
            if not isinstance(wake_limits, dict):
                raise ValueError("wake_limits must be an object")
            min_minutes = int(wake_limits.get("min_minutes", self.min_wake_min))
            max_minutes = int(wake_limits.get("max_minutes", self.max_wake_min))
            if min_minutes < 1 or max_minutes < min_minutes:
                raise ValueError("wake_limits must satisfy 1 <= min_minutes <= max_minutes")
            self.min_wake_min = min_minutes
            self.max_wake_min = max_minutes

        if "dice_threshold" in settings:
            dice_threshold = int(settings["dice_threshold"])
            if dice_threshold < 0 or dice_threshold > 5:
                raise ValueError("dice_threshold must be between 0 and 5")
            self.dice_threshold = dice_threshold

        self._next_wake = self._get_next_anchor_dt() if self.enabled else None
        return self.get_config()

    def get_config(self) -> dict:
        """Return normalized runtime scheduler config."""
        return {
            "enabled": self.enabled,
            "timezone": getattr(self.tz, "key", None) or "UTC",
            "cache_ttl_minutes": self.cache_ttl,
            "anchors": [_format_time(anchor) for anchor in self.anchors],
            "sleep_window": {
                "start": _format_time(self.sleep_start),
                "end": _format_time(self.sleep_end),
            },
            "wake_limits": {
                "min_minutes": self.min_wake_min,
                "max_minutes": self.max_wake_min,
            },
            "dice_threshold": self.dice_threshold,
        }

    def get_log(self, limit: int = 20) -> list[dict]:
        """Return recent awakening log entries, newest first."""
        return list(reversed(self._log[-limit:]))

    # ==========================================================
    # Log persistence
    # ==========================================================

    def _append_log(self, entry: dict) -> None:
        """Append an entry to the awakening log (in-memory + file)."""
        self._log.append(entry)
        # Keep only last 50 entries
        if len(self._log) > 50:
            self._log = self._log[-50:]
        self._save_log()

    def _save_log(self) -> None:
        """Persist awakening log to disk."""
        try:
            os.makedirs(os.path.dirname(self._log_path), exist_ok=True)
            with open(self._log_path, "w", encoding="utf-8") as f:
                _json_lib.dump(self._log, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save awakening log: {e}")

    def _load_log(self) -> list:
        """Load awakening log from disk."""
        try:
            if os.path.exists(self._log_path):
                with open(self._log_path, "r", encoding="utf-8") as f:
                    data = _json_lib.load(f)
                if isinstance(data, list):
                    return data[-50:]  # cap at 50
        except Exception as e:
            logger.warning(f"Failed to load awakening log: {e}")
        return []
