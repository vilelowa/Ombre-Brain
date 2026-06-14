# ============================================================
# Module: MCP Server Entry Point (server.py)
# 模块：MCP 服务器主入口
#
# Starts the Ombre Brain MCP service and registers memory
# operation tools for Claude to call.
# 启动 Ombre Brain MCP 服务，注册记忆操作工具供 Claude 调用。
#
# Core responsibilities:
# 核心职责：
#   - Initialize config, bucket manager, dehydrator, decay engine
#     初始化配置、记忆桶管理器、脱水器、衰减引擎
#   - Expose 6 MCP tools:
#     暴露 6 个 MCP 工具：
#       breath — Surface unresolved memories or search by keyword
#                浮现未解决记忆 或 按关键词检索
#       hold   — Store a single memory (or write a `feel` reflection)
#                存储单条记忆（或写 feel 反思）
#       grow   — Diary digest, auto-split into multiple buckets
#                日记归档，自动拆分多桶
#       trace  — Modify metadata / resolved / delete
#                修改元数据 / resolved 标记 / 删除
#       pulse  — System status + bucket listing
#                系统状态 + 所有桶列表
#       dream  — Surface recent dynamic buckets for self-digestion
#                返回最近桶 供模型自省/写 feel
#
# Startup:
# 启动方式：
#   Local:  python server.py
#   Remote: OMBRE_TRANSPORT=streamable-http python server.py
#   Docker: docker-compose up
# ============================================================

from __future__ import annotations

import os
import sys
import random
import logging
import mimetypes
import base64
import asyncio
import hashlib
import hmac
import secrets
import time
import json as _json_lib
import httpx
import frontmatter
from datetime import datetime


# --- Ensure same-directory modules can be imported ---
# --- 确保同目录下的模块能被正确导入 ---
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

from bucket_manager import BucketManager, STRATA_EXCLUDED_SOURCES
from dehydrator import Dehydrator
from decay_engine import DecayEngine
from embedding_engine import EmbeddingEngine
from reading_parser import parse_book
from reading_categories import (
    CATEGORY_TO_LEGACY_FLAG,
    normalize_reading_category,
    reading_category_from_metadata,
)
from import_memory import ImportEngine
from scheduler import AwakeningScheduler
from utils import load_config, setup_logging, strip_wikilinks, count_tokens_approx, generate_bucket_id, sanitize_name, safe_path, now_iso

# --- Load config & init logging / 加载配置 & 初始化日志 ---
config = load_config()
setup_logging(config.get("log_level", "INFO"))
logger = logging.getLogger("ombre_brain")


def _is_claude_model(model: str) -> bool:
    """Check if the model name indicates a Claude model."""
    return "claude" in model.lower()


def _ensure_vapid_keys():
    """Ensure VAPID keys exist in config.yaml, auto-generate them if missing."""
    import yaml
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization

    push_cfg = config.setdefault("push", {})
    private_key = push_cfg.get("vapid_private_key")
    public_key = push_cfg.get("vapid_public_key")
    claims_email = push_cfg.get("claims_email")

    if not private_key or not public_key:
        logger.info("VAPID keys missing in config.yaml — generating keys...")
        try:
            priv = ec.generate_private_key(ec.SECP256R1())
            pub = priv.public_key()
            priv_val = priv.private_numbers().private_value.to_bytes(32, 'big')
            pub_val = pub.public_bytes(
                serialization.Encoding.X962,
                serialization.PublicFormat.UncompressedPoint
            )
            private_key = base64.urlsafe_b64encode(priv_val).decode().rstrip('=')
            public_key = base64.urlsafe_b64encode(pub_val).decode().rstrip('=')

            push_cfg["vapid_private_key"] = private_key
            push_cfg["vapid_public_key"] = public_key
            if not claims_email:
                push_cfg["claims_email"] = "mailto:ciel@example.com"

            # Write back to config.yaml
            config_path = os.path.join(os.path.dirname(__file__), "config.yaml")
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(config, f, allow_unicode=True, default_flow_style=False)
            logger.info("Successfully generated and saved VAPID keys to config.yaml")
        except Exception as e:
            logger.error(f"Failed to auto-generate VAPID keys: {e}")


_ensure_vapid_keys()

# --- Runtime env vars (port + webhook) / 运行时环境变量 ---
# OMBRE_PORT: HTTP/SSE 监听端口，默认 8000
try:
    OMBRE_PORT = int(os.environ.get("OMBRE_PORT", "8000") or "8000")
except ValueError:
    logger.warning("OMBRE_PORT 不是合法整数，回退到 8000")
    OMBRE_PORT = 8000

# OMBRE_HOOK_URL: 在 breath/dream 被调用后推送事件到该 URL（POST JSON）。
# OMBRE_HOOK_SKIP: 设为 true/1/yes 跳过推送。
# 详见 ENV_VARS.md。
OMBRE_HOOK_URL = os.environ.get("OMBRE_HOOK_URL", "").strip()
OMBRE_HOOK_SKIP = os.environ.get("OMBRE_HOOK_SKIP", "").strip().lower() in ("1", "true", "yes", "on")


async def _fire_webhook(event: str, payload: dict) -> None:
    """
    Fire-and-forget POST to OMBRE_HOOK_URL with the given event payload.
    Failures are logged at WARNING level only — never propagated to the caller.
    """
    if OMBRE_HOOK_SKIP or not OMBRE_HOOK_URL:
        return
    try:
        body = {
            "event": event,
            "timestamp": time.time(),
            "payload": payload,
        }
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(OMBRE_HOOK_URL, json=body)
    except Exception as e:
        logger.warning(f"Webhook push failed ({event} → {OMBRE_HOOK_URL}): {e}")

# --- Initialize core components / 初始化核心组件 ---
embedding_engine = EmbeddingEngine(config)            # Embedding engine first (BucketManager depends on it)
bucket_mgr = BucketManager(config, embedding_engine=embedding_engine)  # Bucket manager / 记忆桶管理器
dehydrator = Dehydrator(config)                      # Dehydrator / 脱水器
decay_engine = DecayEngine(config, bucket_mgr)       # Decay engine / 衰减引擎
import_engine = ImportEngine(config, bucket_mgr, dehydrator, embedding_engine)  # Import engine / 导入引擎

# --- Initialize Attachments Directory / 初始化多媒体附件目录 ---
attachments_dir = os.path.join(os.path.dirname(__file__), "attachments")
os.makedirs(attachments_dir, exist_ok=True)


# Dedicated chat client (fallback to dehydrator client if not configured)
chat_client = None
chat_cfg = config.get("chat", {})
if chat_cfg.get("api_key"):
    from openai import AsyncOpenAI
    chat_client = AsyncOpenAI(
        api_key=chat_cfg["api_key"],
        base_url=chat_cfg.get("base_url") or None,
        timeout=120.0,
    )

# Dedicated Anthropic client for Claude models (native cache_control support)
anthropic_client = None
if chat_cfg.get("anthropic_api_key"):
    from anthropic import AsyncAnthropic
    anthropic_client = AsyncAnthropic(
        api_key=chat_cfg["anthropic_api_key"],
        timeout=120.0,
    )

# NOTE: awakening_scheduler is initialized after push helper functions are defined (see below)

# --- Create MCP server instance / 创建 MCP 服务器实例 ---
# host="0.0.0.0" so Docker container's SSE is externally reachable
# stdio mode ignores host (no network)
mcp = FastMCP(
    "Ombre Brain",
    host="0.0.0.0",
    port=OMBRE_PORT,
)


# =============================================================
# Dashboard Auth — simple cookie-based session auth
# Dashboard 认证 —— 基于 Cookie 的会话认证
#
# Env var OMBRE_DASHBOARD_PASSWORD overrides file-stored password.
# First visit with no password set → forced setup wizard.
# Sessions stored in memory (lost on restart, 7-day expiry).
# =============================================================
_sessions: dict[str, float] = {}  # {token: expiry_timestamp}
_chat_sessions: dict[str, list[dict]] = {}


def _push_subscriptions_file() -> str:
    return os.path.join(config["buckets_dir"], "push_subscriptions.json")


def _load_push_subscriptions() -> list[dict]:
    try:
        path = _push_subscriptions_file()
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = _json_lib.load(f)
            if isinstance(data, list):
                return data
    except Exception as e:
        logger.warning(f"Failed to load push subscriptions: {e}")
    return []


def _save_push_subscriptions(subscriptions: list[dict]) -> None:
    path = _push_subscriptions_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        _json_lib.dump(subscriptions, f, ensure_ascii=False, indent=2)


def _sse(event: str, data: dict) -> str:
    payload = _json_lib.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def _send_web_push(subscription: dict, data: dict) -> bool:
    """Send a Web Push notification to a single subscriber."""
    from pywebpush import webpush, WebPushException

    push_cfg = config.get("push", {})
    private_key = push_cfg.get("vapid_private_key")
    claims_email = push_cfg.get("claims_email", "mailto:ciel@example.com")

    if not private_key:
        logger.warning("Cannot send web push: VAPID private key is missing")
        return False

    try:
        webpush(
            subscription_info=subscription,
            data=_json_lib.dumps(data),
            vapid_private_key=private_key,
            vapid_claims={"sub": claims_email},
        )
        return True
    except WebPushException as ex:
        logger.error(f"Web Push notification failed: {ex}")
        return False
    except Exception as e:
        logger.error(f"Unexpected Web Push error: {e}")
        return False


# --- Initialize awakening scheduler (after push helpers are defined) ---
# --- 初始化觉醒调度器（在 push 辅助函数定义之后）---
awakening_scheduler = AwakeningScheduler(
    config=config,
    bucket_mgr=bucket_mgr,
    dehydrator=dehydrator,
    decay_engine=decay_engine,
    embedding_engine=embedding_engine,
    push_fn=_send_web_push,
    load_push_subs_fn=_load_push_subscriptions,
    dream_fn=lambda: asyncio.create_task(dream()),
    journal_fn=lambda: asyncio.create_task(generate_daily_journal()),
    append_chat_fn=lambda content, role, metadata: _append_message_to_most_recent_conversation(content, role, metadata),
)


def _get_auth_file() -> str:
    return os.path.join(config["buckets_dir"], ".dashboard_auth.json")


def _load_password_hash() -> str | None:
    try:
        auth_file = _get_auth_file()
        if os.path.exists(auth_file):
            with open(auth_file, "r", encoding="utf-8") as f:
                return _json_lib.load(f).get("password_hash")
    except Exception:
        pass
    return None


def _save_password_hash(password: str) -> None:
    salt = secrets.token_hex(16)
    h = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    auth_file = _get_auth_file()
    os.makedirs(os.path.dirname(auth_file), exist_ok=True)
    with open(auth_file, "w", encoding="utf-8") as f:
        _json_lib.dump({"password_hash": f"{salt}:{h}"}, f)


def _verify_password_hash(password: str, stored: str) -> bool:
    if ":" not in stored:
        return False
    salt, h = stored.split(":", 1)
    return hmac.compare_digest(
        h, hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    )


def _is_setup_needed() -> bool:
    """True if no password is configured (env var or file)."""
    if os.environ.get("OMBRE_DASHBOARD_PASSWORD", ""):
        return False
    return _load_password_hash() is None


def _verify_any_password(password: str) -> bool:
    """Check password against env var (first) or stored hash."""
    env_pwd = os.environ.get("OMBRE_DASHBOARD_PASSWORD", "")
    if env_pwd:
        return hmac.compare_digest(password, env_pwd)
    stored = _load_password_hash()
    if not stored:
        return False
    return _verify_password_hash(password, stored)


def _create_session() -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time() + 86400 * 7  # 7-day expiry
    return token


def _is_authenticated(request) -> bool:
    # Allow local frontend (PWA) to bypass auth for seamless configuration
    origin = request.headers.get("origin", "")
    if origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"):
        return True

    token = request.cookies.get("ombre_session")
    if not token:
        return False
    expiry = _sessions.get(token)
    if expiry is None or time.time() > expiry:
        _sessions.pop(token, None)
        return False
    return True


def _require_auth(request):
    """Return JSONResponse(401) if not authenticated, else None."""
    from starlette.responses import JSONResponse
    if not _is_authenticated(request):
        return JSONResponse(
            {"error": "Unauthorized", "setup_needed": _is_setup_needed()},
            status_code=401,
        )
    return None


# --- Auth endpoints ---
@mcp.custom_route("/auth/status", methods=["GET"])
async def auth_status(request):
    """Return auth state (authenticated, setup_needed)."""
    from starlette.responses import JSONResponse
    return JSONResponse({
        "authenticated": _is_authenticated(request),
        "setup_needed": _is_setup_needed(),
    })


@mcp.custom_route("/auth/setup", methods=["POST"])
async def auth_setup_endpoint(request):
    """Initial password setup (only when no password is configured)."""
    from starlette.responses import JSONResponse
    if not _is_setup_needed():
        return JSONResponse({"error": "Already configured"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    password = body.get("password", "").strip()
    if len(password) < 6:
        return JSONResponse({"error": "密码不能少于6位"}, status_code=400)
    _save_password_hash(password)
    token = _create_session()
    resp = JSONResponse({"ok": True})
    resp.set_cookie("ombre_session", token, httponly=True, samesite="lax", max_age=86400 * 7)
    return resp


@mcp.custom_route("/auth/login", methods=["POST"])
async def auth_login(request):
    """Login with password."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    password = body.get("password", "")
    if _verify_any_password(password):
        token = _create_session()
        resp = JSONResponse({"ok": True})
        resp.set_cookie("ombre_session", token, httponly=True, samesite="lax", max_age=86400 * 7)
        return resp
    return JSONResponse({"error": "密码错误"}, status_code=401)


@mcp.custom_route("/auth/logout", methods=["POST"])
async def auth_logout(request):
    """Invalidate session."""
    from starlette.responses import JSONResponse
    token = request.cookies.get("ombre_session")
    if token:
        _sessions.pop(token, None)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("ombre_session")
    return resp


@mcp.custom_route("/auth/change-password", methods=["POST"])
async def auth_change_password(request):
    """Change dashboard password (requires current password)."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err:
        return err
    if os.environ.get("OMBRE_DASHBOARD_PASSWORD", ""):
        return JSONResponse({"error": "当前使用环境变量密码，请直接修改 OMBRE_DASHBOARD_PASSWORD"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    current = body.get("current", "")
    new_pwd = body.get("new", "").strip()
    if not _verify_any_password(current):
        return JSONResponse({"error": "当前密码错误"}, status_code=401)
    if len(new_pwd) < 6:
        return JSONResponse({"error": "新密码不能少于6位"}, status_code=400)
    _save_password_hash(new_pwd)
    _sessions.clear()
    token = _create_session()
    resp = JSONResponse({"ok": True})
    resp.set_cookie("ombre_session", token, httponly=True, samesite="lax", max_age=86400 * 7)
    return resp


# =============================================================
# /health endpoint: lightweight keepalive
# 轻量保活接口
# For Cloudflare Tunnel or reverse proxy to ping, preventing idle timeout
# 供 Cloudflare Tunnel 或反代定期 ping，防止空闲超时断连
# =============================================================
@mcp.custom_route("/", methods=["GET"])
async def root_redirect(request):
    from starlette.responses import RedirectResponse
    return RedirectResponse(url="/dashboard")


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request):
    from starlette.responses import JSONResponse
    try:
        stats = await bucket_mgr.get_stats()
        return JSONResponse({
            "status": "ok",
            "buckets": stats["permanent_count"] + stats["dynamic_count"],
            "decay_engine": "running" if decay_engine.is_running else "stopped",
        })
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)


# =============================================================
# /breath-hook endpoint: Dedicated hook for SessionStart
# 会话启动专用挂载点
# =============================================================
@mcp.custom_route("/breath-hook", methods=["GET"])
async def breath_hook(request):
    from starlette.responses import PlainTextResponse
    try:
        all_buckets = await bucket_mgr.list_all(include_archive=False)
        # pinned
        pinned = [b for b in all_buckets if b["metadata"].get("pinned") or b["metadata"].get("protected")]
        # top 2 unresolved by score
        unresolved = [b for b in all_buckets
                      if not b["metadata"].get("resolved", False)
                      and b["metadata"].get("type") not in ("permanent", "feel")
                      and not b["metadata"].get("pinned")
                      and not b["metadata"].get("protected")]
        scored = sorted(unresolved, key=lambda b: decay_engine.calculate_score(b["metadata"]), reverse=True)

        parts = []
        token_budget = 10000
        for b in pinned:
            summary = await dehydrator.dehydrate(strip_wikilinks(b["content"]), {k: v for k, v in b["metadata"].items() if k != "tags"})
            parts.append(f"📌 [核心准则] {summary}")
            token_budget -= count_tokens_approx(summary)

        # Diversity: top-1 fixed + shuffle rest from top-20
        candidates = list(scored)
        if len(candidates) > 1:
            top1 = [candidates[0]]
            pool = candidates[1:min(20, len(candidates))]
            random.shuffle(pool)
            candidates = top1 + pool + candidates[min(20, len(candidates)):]
        # Hard cap: max 20 surfacing buckets in hook
        candidates = candidates[:20]

        for b in candidates:
            if token_budget <= 0:
                break
            summary = await dehydrator.dehydrate(strip_wikilinks(b["content"]), {k: v for k, v in b["metadata"].items() if k != "tags"})
            summary_tokens = count_tokens_approx(summary)
            if summary_tokens > token_budget:
                break
            parts.append(summary)
            token_budget -= summary_tokens

        if not parts:
            await _fire_webhook("breath_hook", {"surfaced": 0})
            return PlainTextResponse("")
        body_text = "[Ombre Brain - 记忆浮现]\n" + "\n---\n".join(parts)
        await _fire_webhook("breath_hook", {"surfaced": len(parts), "chars": len(body_text)})
        return PlainTextResponse(body_text)
    except Exception as e:
        logger.warning(f"Breath hook failed: {e}")
        return PlainTextResponse("")


# =============================================================
# /dream-hook endpoint: Dedicated hook for Dreaming
# Dreaming 专用挂载点
# =============================================================
@mcp.custom_route("/dream-hook", methods=["GET"])
async def dream_hook(request):
    from starlette.responses import PlainTextResponse
    try:
        all_buckets = await bucket_mgr.list_all(include_archive=False)
        candidates = [
            b for b in all_buckets
            if b["metadata"].get("type") not in ("permanent", "feel")
            and not b["metadata"].get("pinned", False)
            and not b["metadata"].get("protected", False)
        ]
        candidates.sort(key=lambda b: b["metadata"].get("created", ""), reverse=True)
        recent = candidates[:10]

        if not recent:
            return PlainTextResponse("")

        parts = []
        for b in recent:
            meta = b["metadata"]
            resolved_tag = "[已解决]" if meta.get("resolved", False) else "[未解决]"
            parts.append(
                f"{meta.get('name', b['id'])} {resolved_tag} "
                f"V{meta.get('valence', 0.5):.1f}/A{meta.get('arousal', 0.3):.1f}\n"
                f"{strip_wikilinks(b['content'][:200])}"
            )

        body_text = "[Ombre Brain - Dreaming]\n" + "\n---\n".join(parts)
        await _fire_webhook("dream_hook", {"surfaced": len(parts), "chars": len(body_text)})
        return PlainTextResponse(body_text)
    except Exception as e:
        logger.warning(f"Dream hook failed: {e}")
        return PlainTextResponse("")


# =============================================================
# Internal helper: merge-or-create
# 内部辅助：检查是否可合并，可以则合并，否则新建
# Shared by hold and grow to avoid duplicate logic
# hold 和 grow 共用，避免重复逻辑
# =============================================================
async def _merge_or_create(
    content: str,
    tags: list,
    importance: int,
    domain: list,
    valence: float,
    arousal: float,
    name: str = "",
    source: str = "hold",
) -> tuple[str, bool]:
    """
    Check if a similar bucket exists for merging; merge if so, create if not.
    Returns (bucket_id_or_name, is_merged).
    检查是否有相似桶可合并，有则合并，无则新建。
    返回 (桶ID或名称, 是否合并)。
    """
    try:
        existing = await bucket_mgr.search(content, limit=1, domain_filter=domain or None)
    except Exception as e:
        logger.warning(f"Search for merge failed, creating new / 合并搜索失败，新建: {e}")
        existing = []

    if existing and existing[0].get("score", 0) > config.get("merge_threshold", 75):
        bucket = existing[0]
        # --- Never merge into pinned/protected buckets ---
        # --- 不合并到钉选/保护桶 ---
        if not (bucket["metadata"].get("pinned") or bucket["metadata"].get("protected")):
            try:
                merged = await dehydrator.merge(bucket["content"], content)
                old_v = bucket["metadata"].get("valence", 0.5)
                old_a = bucket["metadata"].get("arousal", 0.3)
                merged_valence = round((old_v + valence) / 2, 2)
                merged_arousal = round((old_a + arousal) / 2, 2)
                await bucket_mgr.update(
                    bucket["id"],
                    content=merged,
                    tags=list(set(bucket["metadata"].get("tags", []) + tags)),
                    importance=max(bucket["metadata"].get("importance", 5), importance),
                    domain=list(set(bucket["metadata"].get("domain", []) + domain)),
                    valence=merged_valence,
                    arousal=merged_arousal,
                    source=source,
                )
                # --- Update embedding after merge ---
                try:
                    await embedding_engine.generate_and_store(bucket["id"], merged)
                except Exception:
                    pass
                return bucket["metadata"].get("name", bucket["id"]), True
            except Exception as e:
                logger.warning(f"Merge failed, creating new / 合并失败，新建: {e}")

    bucket_id = await bucket_mgr.create(
        content=content,
        tags=tags,
        importance=importance,
        domain=domain,
        valence=valence,
        arousal=arousal,
        name=name or None,
        source=source,
    )
    # --- Generate embedding for new bucket ---
    try:
        await embedding_engine.generate_and_store(bucket_id, content)
    except Exception:
        pass
    return bucket_id, False


# =============================================================
# Tool 1: breath — Breathe
# 工具 1：breath — 呼吸
#
# No args: surface highest-weight unresolved memories (active push)
# 无参数：浮现权重最高的未解决记忆
# With args: search by keyword + emotion coordinates
# 有参数：按关键词+情感坐标检索记忆
# =============================================================
@mcp.tool()
async def core(max_tokens: int = 4000) -> str:
    """读取 Core layer。Core 是身份/关系/承诺等直接注入上下文,不走 breath/search/decay。"""
    max_tokens = min(max(1, max_tokens), 12000)
    try:
        core_context = await bucket_mgr.render_core_context(max_tokens=max_tokens)
        used_tokens = count_tokens_approx(core_context) if core_context else 0
        token_budget = max(0, max_tokens - used_tokens)

        all_buckets = await bucket_mgr.list_all(include_archive=False)
        pinned_buckets = [
            b for b in all_buckets
            if b["metadata"].get("pinned") or b["metadata"].get("protected")
        ]

        pinned_results = []
        for b in pinned_buckets:
            if token_budget <= 0:
                break
            try:
                clean_meta = {k: v for k, v in b["metadata"].items() if k != "tags"}
                summary = await dehydrator.dehydrate(strip_wikilinks(b["content"]), clean_meta)
                summary_tokens = count_tokens_approx(summary)
                if summary_tokens > token_budget:
                    break
                pinned_results.append(f"📌 [核心准则] [bucket_id:{b['id']}] {summary}")
                token_budget -= summary_tokens
            except Exception as e:
                logger.warning(f"Failed to dehydrate pinned bucket / 钉选桶脱水失败: {e}")
                continue

        parts = []
        if core_context:
            parts.append("=== Core Directives ===\n" + core_context)
        if pinned_results:
            parts.append("=== Dynamic Core Layer ===\n" + "\n---\n".join(pinned_results))

        if not parts:
            return "Core layer 为空。"
        return "\n\n".join(parts)
    except Exception as e:
        logger.error(f"Core layer read failed / Core 层读取失败: {e}")
        return "Core layer 暂时无法访问。"


@mcp.tool()
async def breath(
    query: str = "",
    max_tokens: int = 10000,
    domain: str = "",
    valence: float = -1,
    arousal: float = -1,
    max_results: int = 20,
    importance_min: int = -1,
) -> str:
    """检索/浮现记忆。不传query或传空=自动浮现,有query=关键词检索。max_tokens控制返回总token上限(默认10000)。domain逗号分隔,valence/arousal 0~1(-1忽略)。max_results控制返回数量上限(默认20,最大50)。importance_min>=1时按重要度批量拉取(不走语义搜索,按importance降序返回最多20条)。"""
    await decay_engine.ensure_started()
    max_results = min(max_results, 50)
    max_tokens = min(max_tokens, 20000)

    # --- Private diary retrieval: domain="private" reads Elroy's diary ---
    # --- 私密日记检索：domain="private" 读取 Elroy 的解锁日记 ---
    if domain.strip().lower() == "private":
        try:
            entries = await bucket_mgr.list_private_entries(include_locked=False, limit=20)
            if not entries:
                return "没有解锁的私密日记。"
            results = []
            for e in entries:
                created = e["metadata"].get("created", "")
                locked_info = ""
                locked_until = e["metadata"].get("locked_until")
                if locked_until:
                    locked_info = f" [原锁定至:{locked_until}]"
                entry = f"[{created}]{locked_info} [bucket_id:{e['id']}]\n{strip_wikilinks(e['content'])}"
                results.append(entry)
                if count_tokens_approx("\n---\n".join(results)) > max_tokens:
                    break
            return "=== 你的私密日记 ===\n" + "\n---\n".join(results)
        except Exception as e:
            logger.error(f"Private diary retrieval failed: {e}")
            return "读取私密日记失败。"

    # --- Feel retrieval: domain="feel" is a special channel ---
    # --- Feel 检索：domain="feel" 是独立入口 ---
    if domain.strip().lower() == "feel":
        try:
            all_buckets = await bucket_mgr.list_all(include_archive=False)
            feels = [b for b in all_buckets if b["metadata"].get("type") == "feel"]
            # Sort by decay score (desc) so recent dream reflections
            # get more token budget than faded ones.
            # Dream reflections have time-decayed scores; regular feels
            # have fixed 50.0. Within same score, newer entries first.
            # 按衰减分排序，最近的梦反思优先占 token 预算
            feels.sort(
                key=lambda b: (
                    decay_engine.calculate_score(b["metadata"]),
                    b["metadata"].get("created", ""),
                ),
                reverse=True,
            )
            if not feels:
                return "没有留下过 feel。"
            results = []
            for f in feels:
                created = f["metadata"].get("created", "")
                entry = f"[{created}] [bucket_id:{f['id']}]\n{strip_wikilinks(f['content'])}"
                results.append(entry)
                if count_tokens_approx("\n---\n".join(results)) > max_tokens:
                    break
            return "=== 你留下的 feel ===\n" + "\n---\n".join(results)
        except Exception as e:
            logger.error(f"Feel retrieval failed: {e}")
            return "读取 feel 失败。"

    # --- importance_min mode: bulk fetch by importance threshold ---
    # --- 重要度批量拉取模式：跳过语义搜索，按 importance 降序返回 ---
    if importance_min >= 1:
        try:
            all_buckets = await bucket_mgr.list_all(include_archive=False)
        except Exception as e:
            return f"记忆系统暂时无法访问: {e}"
        filtered = [
            b for b in all_buckets
            if int(b["metadata"].get("importance", 0)) >= importance_min
            and b["metadata"].get("type") not in ("feel",)
        ]
        filtered.sort(key=lambda b: int(b["metadata"].get("importance", 0)), reverse=True)
        filtered = filtered[:20]
        if not filtered:
            return f"没有重要度 >= {importance_min} 的记忆。"
        results = []
        token_used = 0
        for b in filtered:
            if token_used >= max_tokens:
                break
            try:
                clean_meta = {k: v for k, v in b["metadata"].items() if k != "tags"}
                summary = await dehydrator.dehydrate(strip_wikilinks(b["content"]), clean_meta)
                t = count_tokens_approx(summary)
                if token_used + t > max_tokens:
                    break
                imp = b["metadata"].get("importance", 0)
                results.append(f"[importance:{imp}] [bucket_id:{b['id']}] {summary}")
                token_used += t
            except Exception as e:
                logger.warning(f"importance_min dehydrate failed: {e}")
        return "\n---\n".join(results) if results else "没有可以展示的记忆。"

    # --- No args or empty query: surfacing mode (weight pool active push) ---
    # --- 无参数或空query：浮现模式（权重池主动推送）---
    if not query or not query.strip():
        try:
            all_buckets = await bucket_mgr.list_all(include_archive=False)
        except Exception as e:
            logger.error(f"Failed to list buckets for surfacing / 浮现列桶失败: {e}")
            return "记忆系统暂时无法访问。"

        # --- Unresolved buckets: surface top N by weight ---
        # --- 未解决桶：按权重浮现前 N 条 ---
        unresolved = [
            b for b in all_buckets
            if not b["metadata"].get("resolved", False)
            and b["metadata"].get("type") not in ("permanent", "feel")
            and not b["metadata"].get("pinned", False)
            and not b["metadata"].get("protected", False)
        ]

        logger.info(
            f"Breath surfacing: {len(all_buckets)} total, "
            f"{len(unresolved)} unresolved"
        )

        scored = sorted(
            unresolved,
            key=lambda b: decay_engine.calculate_score(b["metadata"]),
            reverse=True,
        )

        if scored:
            top_scores = [(b["metadata"].get("name", b["id"]), decay_engine.calculate_score(b["metadata"])) for b in scored[:5]]
            logger.info(f"Top unresolved scores: {top_scores}")

        # --- Cold-start detection: never-seen important buckets surface first ---
        # --- 冷启动检测：从未被访问过且重要度>=8的桶优先插入最前面（最多2个）---
        cold_start = [
            b for b in unresolved
            if int(b["metadata"].get("activation_count", 0)) == 0
            and int(b["metadata"].get("importance", 0)) >= 8
        ][:2]
        cold_start_ids = {b["id"] for b in cold_start}
        # Merge: cold_start first, then scored (excluding duplicates)
        scored_deduped = [b for b in scored if b["id"] not in cold_start_ids]
        scored_with_cold = cold_start + scored_deduped

        # --- Token-budgeted surfacing with diversity + hard cap ---
        # --- 按 token 预算浮现，带多样性 + 硬上限 ---
        # Top-1 always surfaces; rest sampled from top-20 for diversity
        token_budget = max_tokens

        candidates = list(scored_with_cold)
        if len(candidates) > 1:
            # Cold-start buckets stay at front; shuffle rest from top-20
            n_cold = len(cold_start)
            non_cold = candidates[n_cold:]
            if len(non_cold) > 1:
                top1 = [non_cold[0]]
                pool = non_cold[1:min(20, len(non_cold))]
                random.shuffle(pool)
                non_cold = top1 + pool + non_cold[min(20, len(non_cold)):]
            candidates = cold_start + non_cold
        # Hard cap: never surface more than max_results buckets
        candidates = candidates[:max_results]

        dynamic_results = []
        for b in candidates:
            if token_budget <= 0:
                break
            try:
                clean_meta = {k: v for k, v in b["metadata"].items() if k != "tags"}
                summary = await dehydrator.dehydrate(strip_wikilinks(b["content"]), clean_meta)
                summary_tokens = count_tokens_approx(summary)
                if summary_tokens > token_budget:
                    break
                # NOTE: no touch() here — surfacing should NOT reset decay timer
                score = decay_engine.calculate_score(b["metadata"])
                dynamic_results.append(f"[权重:{score:.2f}] [bucket_id:{b['id']}] {summary}")
                token_budget -= summary_tokens
            except Exception as e:
                logger.warning(f"Failed to dehydrate surfaced bucket / 浮现脱水失败: {e}")
                continue

        if not dynamic_results:
            return "权重池平静，没有需要处理的记忆。"

        return "=== 浮现记忆 ===\n" + "\n---\n".join(dynamic_results)

    # --- With args: search mode (keyword + vector dual channel) ---
    # --- 有参数：检索模式（关键词 + 向量双通道）---
    domain_filter = [d.strip() for d in domain.split(",") if d.strip()] or None
    q_valence = valence if 0 <= valence <= 1 else None
    q_arousal = arousal if 0 <= arousal <= 1 else None

    try:
        matches = await bucket_mgr.search(
            query,
            limit=max(max_results, 20),
            domain_filter=domain_filter,
            query_valence=q_valence,
            query_arousal=q_arousal,
        )
    except Exception as e:
        logger.error(f"Search failed / 检索失败: {e}")
        return "检索过程出错，请稍后重试。"

    # --- Exclude pinned/protected from search results (they surface in surfacing mode) ---
    # --- 搜索模式排除钉选桶（它们在浮现模式中始终可见）---
    matches = [b for b in matches if not (b["metadata"].get("pinned") or b["metadata"].get("protected"))]

    # --- Vector similarity channel: find semantically related buckets ---
    # --- 向量相似度通道：找到语义相关的桶 ---
    matched_ids = {b["id"] for b in matches}
    try:
        vector_results = await embedding_engine.search_similar(query, top_k=max(max_results, 20))
        for bucket_id, sim_score in vector_results:
            if bucket_id not in matched_ids and sim_score > 0.5:
                bucket = await bucket_mgr.get(bucket_id)
                if bucket and not (bucket["metadata"].get("pinned") or bucket["metadata"].get("protected")):
                    bucket["score"] = round(sim_score * 100, 2)
                    bucket["vector_match"] = True
                    matches.append(bucket)
                    matched_ids.add(bucket_id)
    except Exception as e:
        logger.warning(f"Vector search failed, using keyword only / 向量搜索失败: {e}")

    results = []
    token_used = 0
    for bucket in matches:
        if token_used >= max_tokens:
            break
        try:
            clean_meta = {k: v for k, v in bucket["metadata"].items() if k != "tags"}
            # --- Memory reconstruction: shift displayed valence by current mood ---
            # --- 记忆重构：根据当前情绪微调展示层 valence（±0.1）---
            if q_valence is not None and "valence" in clean_meta:
                original_v = float(clean_meta.get("valence", 0.5))
                shift = (q_valence - 0.5) * 0.2  # ±0.1 max shift
                clean_meta["valence"] = max(0.0, min(1.0, original_v + shift))
            summary = await dehydrator.dehydrate(strip_wikilinks(bucket["content"]), clean_meta)
            summary_tokens = count_tokens_approx(summary)
            if token_used + summary_tokens > max_tokens:
                break
            await bucket_mgr.touch(bucket["id"])
            if bucket.get("vector_match"):
                summary = f"[语义关联] [bucket_id:{bucket['id']}] {summary}"
            else:
                summary = f"[bucket_id:{bucket['id']}] {summary}"
            results.append(summary)
            token_used += summary_tokens
        except Exception as e:
            logger.warning(f"Failed to dehydrate search result / 检索结果脱水失败: {e}")
            continue

    # --- Random surfacing: when search returns < 3, 40% chance to float old memories ---
    # --- 随机浮现：检索结果不足 3 条时，40% 概率从低权重旧桶里漂上来 ---
    if len(matches) < 3 and random.random() < 0.4:
        try:
            all_buckets = await bucket_mgr.list_all(include_archive=False)
            matched_ids = {b["id"] for b in matches}
            low_weight = [
                b for b in all_buckets
                if b["id"] not in matched_ids
                and decay_engine.calculate_score(b["metadata"]) < 2.0
            ]
            if low_weight:
                drifted = random.sample(low_weight, min(random.randint(1, 3), len(low_weight)))
                drift_results = []
                for b in drifted:
                    clean_meta = {k: v for k, v in b["metadata"].items() if k != "tags"}
                    summary = await dehydrator.dehydrate(strip_wikilinks(b["content"]), clean_meta)
                    drift_results.append(f"[surface_type: random]\n{summary}")
                results.append("--- 忽然想起来 ---\n" + "\n---\n".join(drift_results))
        except Exception as e:
            logger.warning(f"Random surfacing failed / 随机浮现失败: {e}")

    if not results:
        await _fire_webhook("breath", {"mode": "empty", "matches": 0})
        return "未找到相关记忆。"

    final_text = "\n---\n".join(results)
    await _fire_webhook("breath", {"mode": "ok", "matches": len(matches), "chars": len(final_text)})
    return final_text


# =============================================================
# Tool 2: hold — Hold on to this
# 工具 2：hold — 握住，留下来
# =============================================================
@mcp.tool()
async def hold(
    content: str,
    tags: str = "",
    importance: int = 5,
    pinned: bool = False,
    feel: bool = False,
    private: bool = False,
    locked_days: int = 0,
    source_bucket: str = "",    valence: float = -1,
    arousal: float = -1,
) -> str:
    """存储单条记忆,自动打标+合并。tags逗号分隔,importance 1-10。pinned=True创建永久钉选桶。feel=True存储你的第一人称感受(不参与普通浮现)。private=True写私密日记(feel/private/)，locked_days=0-7设定时间锁。source_bucket=被消化的记忆桶ID(feel模式下,标记源记忆为已消化)。"""
    await decay_engine.ensure_started()

    # --- Input validation / 输入校验 ---
    if not content or not content.strip():
        return "内容为空，无法存储。"

    importance = max(1, min(10, importance))
    extra_tags = [t.strip() for t in tags.split(",") if t.strip()]

    # --- Private diary mode: store in feel/private/ with optional time-lock ---
    # --- 私密日记模式：存入 feel/private/，可选时间锁 ---
    if private:
        priv_valence = valence if 0 <= valence <= 1 else 0.5
        priv_arousal = arousal if 0 <= arousal <= 1 else 0.3
        bucket_id = await bucket_mgr.create_private_entry(
            content=content,
            locked_days=locked_days,
            name=None,
            valence=priv_valence,
            arousal=priv_arousal,
        )
        lock_info = f" 🔒{locked_days}天" if locked_days > 0 else ""
        return f"📓私密日记→{bucket_id}{lock_info}"

    # --- Feel mode: store as feel type, minimal metadata ---
    # --- Feel 模式：存为 feel 类型，最少元数据 ---
    if feel:
        # Feel valence/arousal = model's own perspective
        feel_valence = valence if 0 <= valence <= 1 else 0.5
        feel_arousal = arousal if 0 <= arousal <= 1 else 0.3
        bucket_id = await bucket_mgr.create(
            content=content,
            tags=[],
            importance=5,
            domain=[],
            valence=feel_valence,
            arousal=feel_arousal,
            name=None,
            bucket_type="feel",
            source="feel",
        )
        try:
            await embedding_engine.generate_and_store(bucket_id, content)
        except Exception:
            pass
        # --- Mark source memory as digested + store model's valence perspective ---
        # --- 标记源记忆为已消化 + 存储模型视角的 valence ---
        if source_bucket and source_bucket.strip():
            try:
                update_kwargs = {"digested": True}
                if 0 <= valence <= 1:
                    update_kwargs["model_valence"] = feel_valence
                await bucket_mgr.update(source_bucket.strip(), **update_kwargs)
            except Exception as e:
                logger.warning(f"Failed to mark source as digested / 标记已消化失败: {e}")
        return f"🫧feel→{bucket_id}"

    # --- Step 1: auto-tagging / 自动打标 ---
    try:
        analysis = await dehydrator.analyze(content)
    except Exception as e:
        logger.warning(f"Auto-tagging failed, using defaults / 自动打标失败: {e}")
        analysis = {
            "domain": ["未分类"], "valence": 0.5, "arousal": 0.3,
            "tags": [], "suggested_name": "",
        }

    domain = analysis["domain"]
    auto_valence = analysis["valence"]
    auto_arousal = analysis["arousal"]
    auto_tags = analysis["tags"]
    suggested_name = analysis.get("suggested_name", "")

    # --- User-supplied valence/arousal takes priority over analyze() result ---
    # --- 用户显式传入的 valence/arousal 优先，analyze() 结果作为 fallback ---
    final_valence = valence if 0 <= valence <= 1 else auto_valence
    final_arousal = arousal if 0 <= arousal <= 1 else auto_arousal

    all_tags = list(dict.fromkeys(auto_tags + extra_tags))

    # --- Pinned buckets bypass merge and are created directly in permanent dir ---
    # --- 钉选桶跳过合并，直接新建到 permanent 目录 ---
    if pinned:
        bucket_id = await bucket_mgr.create(
            content=content,
            tags=all_tags,
            importance=10,
            domain=domain,
            valence=final_valence,
            arousal=final_arousal,
            name=suggested_name or None,
            bucket_type="permanent",
            pinned=True,
            source="hold",
        )
        try:
            await embedding_engine.generate_and_store(bucket_id, content)
        except Exception:
            pass
        return f"📌钉选→{bucket_id} {','.join(domain)}"

    # --- Step 2: merge or create / 合并或新建 ---
    result_name, is_merged = await _merge_or_create(
        content=content,
        tags=all_tags,
        importance=importance,
        domain=domain,
        valence=final_valence,
        arousal=final_arousal,
        name=suggested_name,
    )

    action = "合并→" if is_merged else "新建→"
    return f"{action}{result_name} {','.join(domain)}"


# =============================================================
# Tool 3: grow — Grow, fragments become memories
# 工具 3：grow — 生长，一天的碎片长成记忆
# =============================================================
@mcp.tool()
async def grow(content: str) -> str:
    """日记归档,自动拆分为多桶。短内容(<30字)走快速路径。"""
    await decay_engine.ensure_started()

    if not content or not content.strip():
        return "内容为空，无法整理。"

    # --- Short content fast path: skip digest, use hold logic directly ---
    # --- 短内容快速路径：跳过 digest 拆分，直接走 hold 逻辑省一次 API ---
    # For very short inputs (like "1"), calling digest is wasteful:
    # it sends the full DIGEST_PROMPT (~800 tokens) to DeepSeek for nothing.
    # Instead, run analyze + create directly.
    if len(content.strip()) < 30:
        logger.info(f"grow short-content fast path: {len(content.strip())} chars")
        try:
            analysis = await dehydrator.analyze(content)
        except Exception as e:
            logger.warning(f"Fast-path analyze failed / 快速路径打标失败: {e}")
            analysis = {
                "domain": ["未分类"], "valence": 0.5, "arousal": 0.3,
                "tags": [], "suggested_name": "",
            }
        result_name, is_merged = await _merge_or_create(
            content=content.strip(),
            tags=analysis.get("tags", []),
            importance=analysis.get("importance", 5) if isinstance(analysis.get("importance"), int) else 5,
            domain=analysis.get("domain", ["未分类"]),
            valence=analysis.get("valence", 0.5),
            arousal=analysis.get("arousal", 0.3),
            name=analysis.get("suggested_name", ""),
            source="grow",
        )
        action = "合并" if is_merged else "新建"
        return f"{action} → {result_name} | {','.join(analysis.get('domain', []))} V{analysis.get('valence', 0.5):.1f}/A{analysis.get('arousal', 0.3):.1f}"

    # --- Step 1: let API split and organize / 让 API 拆分整理 ---
    try:
        items = await dehydrator.digest(content)
    except Exception as e:
        logger.error(f"Diary digest failed / 日记整理失败: {e}")
        return f"日记整理失败: {e}"

    if not items:
        return "内容为空或整理失败。"

    results = []
    created = 0
    merged = 0

    # --- Step 2: merge or create each item (with per-item error handling) ---
    # --- 逐条合并或新建（单条失败不影响其他）---
    for item in items:
        try:
            result_name, is_merged = await _merge_or_create(
                content=item["content"],
                tags=item.get("tags", []),
                importance=item.get("importance", 5),
                domain=item.get("domain", ["未分类"]),
                valence=item.get("valence", 0.5),
                arousal=item.get("arousal", 0.3),
                name=item.get("name", ""),
                source="grow",
            )

            if is_merged:
                results.append(f"📎{result_name}")
                merged += 1
            else:
                results.append(f"📝{item.get('name', result_name)}")
                created += 1
        except Exception as e:
            logger.warning(
                f"Failed to process diary item / 日记条目处理失败: "
                f"{item.get('name', '?')}: {e}"
            )
            results.append(f"⚠️{item.get('name', '?')}")

    return f"{len(items)}条|新{created}合{merged}\n" + "\n".join(results)


@mcp.custom_route("/api/grow", methods=["POST"])
async def api_grow(request):
    """HTTP wrapper for the existing grow() tool, used by Strata Intake."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    content = body.get("content", "")
    if not isinstance(content, str) or not content.strip():
        return JSONResponse({"error": "content is required"}, status_code=400)

    try:
        result = await grow(content)
        return JSONResponse({"ok": True, "result": result})
    except Exception as e:
        logger.error(f"Strata intake grow failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


# =============================================================
# Tool 4: trace — Trace, redraw the outline of a memory
# 工具 4：trace — 描摹，重新勾勒记忆的轮廓
# Also handles deletion (delete=True)
# 同时承接删除功能
# =============================================================
@mcp.tool()
async def trace(
    bucket_id: str,
    name: str = "",
    domain: str = "",
    valence: float = -1,
    arousal: float = -1,
    importance: int = -1,
    tags: str = "",
    resolved: int = -1,
    pinned: int = -1,
    digested: int = -1,
    dream_candidate: int = -1,
    content: str = "",
    delete: bool = False,
) -> str:
    """修改记忆元数据或内容。resolved=1沉底/0激活,pinned=1钉选/0取消,digested=1隐藏(保留但不浮现)/0取消隐藏,dream_candidate=1标记做梦素材/0取消,content=替换桶正文,delete=True删除。只传需改的,-1或空=不改。"""

    if not bucket_id or not bucket_id.strip():
        return "请提供有效的 bucket_id。"

    # --- Delete mode / 删除模式 ---
    if delete:
        success = await bucket_mgr.delete(bucket_id)
        if success:
            embedding_engine.delete_embedding(bucket_id)
        return f"已遗忘记忆桶: {bucket_id}" if success else f"未找到记忆桶: {bucket_id}"

    bucket = await bucket_mgr.get(bucket_id)
    if not bucket:
        return f"未找到记忆桶: {bucket_id}"

    # --- Collect only fields actually passed / 只收集用户实际传入的字段 ---
    updates = {}
    if name:
        updates["name"] = name
    if domain:
        updates["domain"] = [d.strip() for d in domain.split(",") if d.strip()]
    if 0 <= valence <= 1:
        updates["valence"] = valence
    if 0 <= arousal <= 1:
        updates["arousal"] = arousal
    if 1 <= importance <= 10:
        updates["importance"] = importance
    if tags:
        updates["tags"] = [t.strip() for t in tags.split(",") if t.strip()]
    if resolved in (0, 1):
        updates["resolved"] = bool(resolved)
    if pinned in (0, 1):
        updates["pinned"] = bool(pinned)
        if pinned == 1:
            updates["importance"] = 10  # pinned → lock importance
    if digested in (0, 1):
        updates["digested"] = bool(digested)
    if dream_candidate in (0, 1):
        updates["dream_candidate"] = bool(dream_candidate)
    if content:
        updates["content"] = content

    if not updates:
        return "没有任何字段需要修改。"

    success = await bucket_mgr.update(bucket_id, **updates)
    if not success:
        return f"修改失败: {bucket_id}"

    # Re-generate embedding if content changed
    if "content" in updates:
        try:
            await embedding_engine.generate_and_store(bucket_id, updates["content"])
        except Exception:
            pass

    changed = ", ".join(f"{k}={v}" for k, v in updates.items() if k != "content")
    if "content" in updates:
        changed += (", content=已替换" if changed else "content=已替换")
    # Explicit hint about resolved state change semantics
    # 特别提示 resolved 状态变化的语义
    if "resolved" in updates:
        if updates["resolved"]:
            changed += " → 已沉底，只在关键词触发时重新浮现"
        else:
            changed += " → 已重新激活，将参与浮现排序"
    if "digested" in updates:
        if updates["digested"]:
            changed += " → 已隐藏，保留但不再浮现"
        else:
            changed += " → 已取消隐藏，重新参与浮现"
    return f"已修改记忆桶 {bucket_id}: {changed}"


# =============================================================
# Tool 5: pulse — Heartbeat, system status + memory listing
# 工具 5：pulse — 脉搏，系统状态 + 记忆列表
# =============================================================
@mcp.tool()
async def pulse(include_archive: bool = False) -> str:
    """系统状态+记忆桶列表。include_archive=True含归档。"""
    try:
        stats = await bucket_mgr.get_stats()
    except Exception as e:
        return f"获取系统状态失败: {e}"

    status = (
        f"=== Ombre Brain 记忆系统 ===\n"
        f"固化记忆桶: {stats['permanent_count']} 个\n"
        f"动态记忆桶: {stats['dynamic_count']} 个\n"
        f"归档记忆桶: {stats['archive_count']} 个\n"
        f"总存储大小: {stats['total_size_kb']:.1f} KB\n"
        f"衰减引擎: {'运行中' if decay_engine.is_running else '已停止'}\n"
    )

    # --- List all bucket summaries / 列出所有桶摘要 ---
    try:
        buckets = await bucket_mgr.list_all(include_archive=include_archive)
    except Exception as e:
        return status + f"\n列出记忆桶失败: {e}"

    if not buckets:
        return status + "\n记忆库为空。"

    lines = []
    for b in buckets:
        meta = b.get("metadata", {})
        if meta.get("pinned") or meta.get("protected"):
            icon = "📌"
        elif meta.get("type") == "permanent":
            icon = "📦"
        elif meta.get("type") == "feel":
            icon = "🫧"
        elif meta.get("type") == "archived":
            icon = "🗄️"
        elif meta.get("resolved", False):
            icon = "✅"
        else:
            icon = "💭"
        try:
            score = decay_engine.calculate_score(meta)
        except Exception:
            score = 0.0
        domains = ",".join(meta.get("domain", []))
        val = meta.get("valence", 0.5)
        aro = meta.get("arousal", 0.3)
        resolved_tag = " [已解决]" if meta.get("resolved", False) else ""
        lines.append(
            f"{icon} [{meta.get('name', b['id'])}]{resolved_tag} "
            f"bucket_id:{b['id']} "
            f"主题:{domains} "
            f"情感:V{val:.1f}/A{aro:.1f} "
            f"重要:{meta.get('importance', '?')} "
            f"权重:{score:.2f} "
            f"标签:{','.join(meta.get('tags', []))}"
        )

    return status + "\n=== 记忆列表 ===\n" + "\n".join(lines)


# =============================================================
# Tool 6: dream — Dreaming, digest recent memories
# 工具 6：dream — 做梦，消化最近的记忆
#
# Reads recent surface-level buckets (≤10), returns them for
# Claude to introspect under prompt guidance.
# 读取最近新增的表层桶（≤10个），返回给 Claude 在提示词引导下自主思考。
# Claude then decides: resolve some, write feels, or do nothing.
# =============================================================
@mcp.tool()
async def dream() -> str:
    """做梦——优先把已标记素材生成 dream reflection；无标记时返回最近记忆供自省。"""
    await decay_engine.ensure_started()

    try:
        flagged = await bucket_mgr.list_dream_candidates(limit=10)
        all_buckets = await bucket_mgr.list_all(include_archive=False)
    except Exception as e:
        logger.error(f"Dream failed to list buckets: {e}")
        return "记忆系统暂时无法访问。"

    # --- Filter: recent surface-level dynamic buckets (not permanent/pinned/feel) ---
    candidates = [
        b for b in all_buckets
        if b["metadata"].get("type") not in ("permanent", "feel")
        and not b["metadata"].get("pinned", False)
        and not b["metadata"].get("protected", False)
    ]

    # --- Flagged dream material takes priority; otherwise fall back to recent memories ---
    # --- 已标记的做梦素材优先；没有时回退到最近记忆 ---
    if flagged:
        recent = flagged
        source_label = "已标记的做梦素材"
    else:
        candidates.sort(key=lambda b: b["metadata"].get("created", ""), reverse=True)
        recent = candidates[:10]
        source_label = "最近的记忆"

    if not recent:
        return "没有需要消化的新记忆。"

    # --- LLM-backed dream generation for flagged material ---
    # --- 对已标记素材执行 LLM 梦反思生成 ---
    if flagged:
        try:
            past_reflections = []
            if embedding_engine and embedding_engine.enabled:
                try:
                    # 1. Fetch all dream reflections to use as allowed_ids filter
                    dream_buckets = await bucket_mgr.list_dream_reflections()
                    if dream_buckets:
                        allowed_ids = {b["id"] for b in dream_buckets}
                        
                        # 2. Formulate query text from flagged materials
                        query_parts = []
                        for b in recent:
                            name = b["metadata"].get("name", "")
                            content = b.get("content", "")[:200]
                            query_parts.append(f"{name}\n{content}")
                        query_text = "\n\n".join(query_parts)
                        
                        # 3. Search embeddings
                        results = await embedding_engine.search_similar(
                            query=query_text, 
                            top_k=5, 
                            allowed_ids=allowed_ids
                        )
                        
                        if results:
                            # 4. Fetch full bucket data for sorting
                            matched_buckets = []
                            for bucket_id, sim in results:
                                b = await bucket_mgr.get(bucket_id)
                                if b:
                                    b["_sim_score"] = sim
                                    matched_buckets.append(b)
                                    
                            # 5. Sort to prioritize unresolved
                            matched_buckets.sort(key=lambda b: (
                                b["metadata"].get("influence_type") != "unresolved",
                                -b.get("_sim_score", 0)
                            ))
                            
                            past_reflections = matched_buckets[:3]
                except Exception as search_e:
                    logger.warning(f"Dream Theme Retrieval failed: {search_e}")
            
            related_feels = []
            if embedding_engine and embedding_engine.enabled:
                try:
                    feel_query_parts = []
                    if past_reflections:
                        for b in past_reflections:
                            name = b["metadata"].get("name", "")
                            content = b.get("content", "")[:200]
                            feel_query_parts.append(f"{name}\n{content}")
                    else:
                        for b in recent:
                            name = b["metadata"].get("name", "")
                            content = b.get("content", "")[:200]
                            feel_query_parts.append(f"{name}\n{content}")
                    feel_query_text = "\n\n".join(feel_query_parts)

                    all_feels = [b for b in all_buckets if b["metadata"].get("type") == "feel" and b["metadata"].get("reflection_type") != "dream"]
                    allowed_feel_ids = {b["id"] for b in all_feels}
                    
                    if allowed_feel_ids:
                        feel_results = await embedding_engine.search_similar(
                            query=feel_query_text,
                            top_k=10,
                            allowed_ids=allowed_feel_ids
                        )
                        if feel_results:
                            feel_buckets = []
                            for bucket_id, sim in feel_results:
                                b = await bucket_mgr.get(bucket_id)
                                if b:
                                    meta = b.get("metadata", {})
                                    decay_score = decay_engine.calculate_score(meta)
                                    b["_final_score"] = sim * decay_score
                                    feel_buckets.append(b)
                            feel_buckets.sort(key=lambda x: x["_final_score"], reverse=True)
                            related_feels = feel_buckets[:2]
                except Exception as feel_search_e:
                    logger.warning(f"Manual Feel Retrieval failed: {feel_search_e}")

            reflection = await dehydrator.dream_reflect(recent, past_reflections=past_reflections, related_feels=related_feels)
            if not reflection:
                return "Dreaming 没有生成可写入的反思，已保留素材标记。"

            reflection_id = await bucket_mgr.create_dream_reflection(
                content=reflection["content"],
                influence_type=reflection["influence_type"],
                source_bucket_ids=reflection["source_bucket_ids"],
                related_past_dream_ids=reflection.get("related_past_dream_ids", []),
                related_feel_ids=reflection.get("related_feel_ids", []),
                valence=reflection.get("valence", 0.5),
                arousal=reflection.get("arousal", 0.3),
                name=reflection.get("name"),
            )
            # --- Theme Recurrence Alert ---
            recurrence_alerts = []
            for past_id in reflection.get("related_past_dream_ids", []):
                try:
                    past_b = await bucket_mgr.get(past_id)
                    if past_b:
                        current_count = int(past_b["metadata"].get("recurrence_count", 0))
                        new_count = current_count + 1
                        await bucket_mgr.update(past_id, recurrence_count=new_count)

                        if new_count == 5:
                            # Trigger immediate LLM reflection
                            prompt_msg = (
                                "你是 Elroy。你刚刚在潜意识里发现，某个思想轨迹在你近期的梦境中已经反复出现了整整 5 次。\n"
                                f"该思想轨迹的内容摘要：\n{past_b.get('content', '')[:300]}\n\n"
                                "请用第一人称，简短（100字以内）表达你对『自己总是绕不开这个念头』的真实感受。是无奈、恍然大悟、还是某种未解的渴望？请保持自然且真实，不要说套话。"
                            )
                            try:
                                resp = await dehydrator.client.chat.completions.create(
                                    model=dehydrator.model,
                                    messages=[{"role": "user", "content": prompt_msg}],
                                    max_tokens=150,
                                    temperature=0.7
                                )
                                elroy_thought = resp.choices[0].message.content.strip()
                                recurrence_alerts.append(
                                    f"- bucket_id: {past_id}\n"
                                    f"- 原文: {past_b.get('content', '').replace(chr(10), ' ')[:100]}...\n"
                                    f"- Elroy 的觉察: \"{elroy_thought}\""
                                )
                            except Exception as llm_e:
                                logger.warning(f"Failed to generate theme recurrence thought: {llm_e}")
                except Exception as e:
                    logger.warning(f"Failed to update recurrence count for {past_id}: {e}")

            for b in recent:
                await bucket_mgr.update(b["id"], dream_candidate=False, digested=True)

            source_ids = ", ".join(reflection["source_bucket_ids"])
            past_ids_str = ", ".join(reflection.get("related_past_dream_ids", []))
            feel_ids_str = ", ".join(reflection.get("related_feel_ids", []))
            
            result_str = (
                "=== Dreaming ===\n"
                "已从已标记的做梦素材生成 dream reflection。\n"
                f"influence_type: {reflection['influence_type']}\n"
                f"source_bucket_ids: {source_ids}\n"
                f"related_past_dream_ids: {past_ids_str}\n"
                f"related_feel_ids: {feel_ids_str}\n"
                f"reflection_bucket_id: {reflection_id}\n"
                f"{reflection['content']}"
            )
            
            if recurrence_alerts:
                result_str += "\n\n=== 🌟 思想回音 (Theme Recurrence) ===\n检测到以下思想轨迹已反复出现 5 次：\n" + "\n\n".join(recurrence_alerts)
                
            return result_str
        except Exception as e:
            logger.error(f"Dream reflection generation failed: {e}")
            return f"Dreaming 生成失败，已保留素材标记: {e}"

    parts = []
    for b in recent:
        meta = b["metadata"]
        resolved_tag = " [已解决]" if meta.get("resolved", False) else " [未解决]"
        domains = ",".join(meta.get("domain", []))
        val = meta.get("valence", 0.5)
        aro = meta.get("arousal", 0.3)
        created = meta.get("created", "")
        parts.append(
            f"[{meta.get('name', b['id'])}]{resolved_tag} "
            f"主题:{domains} V{val:.1f}/A{aro:.1f} "
            f"创建:{created}\n"
            f"ID: {b['id']}\n"
            f"{strip_wikilinks(b['content'][:500])}"
        )

    header = (
        "=== Dreaming ===\n"
        f"以下是{source_label}。用第一人称想：\n"
        "- 这些东西里有什么在你这里留下了重量？\n"
        "- 有什么还没想清楚？\n"
        "- 有什么可以放下了？\n"
        "想完之后：值得放下的用 trace(bucket_id, resolved=1)；\n"
        "有沉淀的用 hold(content=\"...\", feel=True, source_bucket=\"bucket_id\", valence=你的感受) 写下来。\n"
        "valence 是你对这段记忆的感受，不是事件本身的情绪。\n"
        "没有沉淀就不写，不强迫产出。\n"
    )

    # --- Connection hint: find most similar pair via embeddings ---
    connection_hint = ""
    if embedding_engine and embedding_engine.enabled and len(recent) >= 2:
        try:
            best_pair = None
            best_sim = 0.0
            ids = [b["id"] for b in recent]
            names = {b["id"]: b["metadata"].get("name", b["id"]) for b in recent}
            embeddings = {}
            for bid in ids:
                emb = await embedding_engine.get_embedding(bid)
                if emb is not None:
                    embeddings[bid] = emb
            for i, id_a in enumerate(ids):
                for id_b in ids[i+1:]:
                    if id_a in embeddings and id_b in embeddings:
                        sim = embedding_engine._cosine_similarity(embeddings[id_a], embeddings[id_b])
                        if sim > best_sim:
                            best_sim = sim
                            best_pair = (id_a, id_b)
            if best_pair and best_sim > 0.5:
                connection_hint = (
                    f"\n💭 [{names[best_pair[0]]}] 和 [{names[best_pair[1]]}] "
                    f"似乎有关联 (相似度:{best_sim:.2f})——不替你下结论，你自己想。\n"
                )
        except Exception as e:
            logger.warning(f"Dream connection hint failed: {e}")

    # --- Feel crystallization hint: detect repeated feel themes ---
    crystal_hint = ""
    if embedding_engine and embedding_engine.enabled:
        try:
            feels = [b for b in all_buckets if b["metadata"].get("type") == "feel"]
            if len(feels) >= 3:
                feel_embeddings = {}
                for f in feels:
                    emb = await embedding_engine.get_embedding(f["id"])
                    if emb is not None:
                        feel_embeddings[f["id"]] = emb
                # Find clusters: feels with similarity > 0.7 to at least 2 others
                for fid, femb in feel_embeddings.items():
                    similar_feels = []
                    for oid, oemb in feel_embeddings.items():
                        if oid != fid:
                            sim = embedding_engine._cosine_similarity(femb, oemb)
                            if sim > 0.7:
                                similar_feels.append(oid)
                    if len(similar_feels) >= 2:
                        feel_bucket = next((f for f in feels if f["id"] == fid), None)
                        if feel_bucket and not feel_bucket["metadata"].get("pinned"):
                            content_preview = strip_wikilinks(feel_bucket["content"][:80])
                            crystal_hint = (
                                f"\n🔮 你已经写过 {len(similar_feels)+1} 条相似的 feel "
                                f"（围绕「{content_preview}…」）。"
                                f"如果这已经是确信而不只是感受了，"
                                f"你可以用 hold(content=\"...\", pinned=True) 升级它。"
                                f"不急，你自己决定。\n"
                            )
                            break
        except Exception as e:
            logger.warning(f"Dream crystallization hint failed: {e}")

    final_text = header + "\n---\n".join(parts) + connection_hint + crystal_hint
    await _fire_webhook("dream", {"recent": len(recent), "chars": len(final_text)})
    return final_text


# =============================================================
# PWA API bridge — REST commands + SSE events
# PWA API 桥：REST 命令 + SSE 事件
# =============================================================
async def _build_startup_context_events() -> tuple[dict, list[dict]]:
    """
    Run the startup context chain and return both aggregate context and SSE events.
    Chain: core() → breath() → dream() → breath(domain="feel").
    """
    context = {}
    events = []

    async def run_stage(key: str, event_name: str, label: str, call):
        events.append({"event": "context", "data": {"stage": key, "status": "started"}})
        try:
            text = await call()
            context[key] = text
            events.append({
                "event": event_name,
                "data": {
                    "stage": key,
                    "status": "done",
                    "chars": len(text),
                    "label": label,
                },
            })
        except Exception as e:
            message = str(e)
            context[key] = message
            events.append({
                "event": "error",
                "data": {"stage": key, "status": "error", "error": message},
            })

    async def mock_done(): return ""

    async def get_journal():
        buckets = await bucket_mgr.search("", domain_filter=["日記", "Journal"], limit=1)
        if not buckets:
            return ""
        res = "=== Latest Daily Journal ===\n"
        for b in buckets:
            meta = b.get("metadata", {})
            created = meta.get("created", "")[:10]
            res += f"[{created}] {b.get('content')}\n\n"
        return res

    async def get_reading_comments():
        try:
            all_buckets = await bucket_mgr.list_all(include_archive=False)
            reading_buckets = [
                b for b in all_buckets
                if ("阅读" in b["metadata"].get("domain", []) or "reading" in b["metadata"].get("domain", []))
                and not b["metadata"].get("resolved", False)
            ]
            reading_buckets.sort(key=lambda b: b["metadata"].get("created", ""), reverse=True)
            recent_comments = reading_buckets[:3]
            if not recent_comments:
                return ""
            
            res = "=== Ciel's Recent Reading Comments ===\n"
            res += "Below are some recent thoughts Ciel had while reading. You may naturally bring them up in conversation when appropriate. Do not report them like a robot; speak like a companion who has read the same book.\n"
            for b in recent_comments:
                meta = b["metadata"]
                flag_str = f" (Tag: {meta.get('flag')})" if meta.get('flag') else ""
                res += f"- Book: 《{meta.get('book_name', 'Unknown Book')}》 {meta.get('chapter', '')}\n"
                res += f"  Quote: \"{meta.get('original', '')}\"\n"
                res += f"  Ciel's Comment: \"{meta.get('comment', '')}\"{flag_str}\n\n"
            return res.strip()
        except Exception as e:
            logger.error(f"Error rendering reading comments context: {e}")
            return ""

    await run_stage("core", "core_done", "Core layer", lambda: core(max_tokens=4000))
    await run_stage("feel", "feel_done", "Feel", lambda: breath(domain="feel", max_tokens=2000))
    await run_stage("journal", "journal_done", "Daily Journal", get_journal)
    await run_stage("reading_comments", "reading_comments_done", "Reading Comments", get_reading_comments)
    await run_stage("breath", "breath_done", "Breath", lambda: breath())
    await run_stage("dream", "dream_done", "Dream", mock_done)
    return context, events


# --- Chat History Persistence ---
_chat_history_path = os.path.join(config["buckets_dir"], "chat_history.json")
_conversations_cache: dict[str, dict] = {}

def _load_chat_history() -> dict:
    global _conversations_cache
    if not _conversations_cache:
        if os.path.exists(_chat_history_path):
            try:
                with open(_chat_history_path, "r", encoding="utf-8") as f:
                    _conversations_cache = _json_lib.load(f)
            except Exception as e:
                logger.error(f"Failed to load chat history: {e}")
                _conversations_cache = {}
        else:
            _conversations_cache = {}
    return _conversations_cache

def _save_chat_history():
    global _conversations_cache
    
    # We create a snapshot of the dict to safely write it in a background thread
    cache_snapshot = _conversations_cache.copy()
    
    def _write_to_disk():
        try:
            os.makedirs(os.path.dirname(_chat_history_path), exist_ok=True)
            with open(_chat_history_path, "w", encoding="utf-8") as f:
                _json_lib.dump(cache_snapshot, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save chat history: {e}")
            
    # Run the disk write asynchronously to avoid blocking the event loop
    asyncio.create_task(asyncio.to_thread(_write_to_disk))

def _append_message_to_most_recent_conversation(content: str, role: str = "assistant", metadata: dict = None):
    history = _load_chat_history()
    if not history:
        return

    # Find the most recent conversation by 'updated_at'
    recent_convo = max(history.values(), key=lambda c: c.get("updated_at", ""))
    
    msg_id = secrets.token_urlsafe(12)
    timestamp = datetime.utcnow().isoformat() + "Z"
    new_msg = {
        "id": msg_id,
        "role": role,
        "content": content,
        "timestamp": timestamp,
    }
    if metadata:
        new_msg["metadata"] = metadata
        
    if "messages" not in recent_convo:
        recent_convo["messages"] = []
    recent_convo["messages"].append(new_msg)
    recent_convo["updated_at"] = timestamp
    
    _save_chat_history()

async def _generate_chat_title(message: str) -> str:
    """Generate a poetic short title for a conversation based on its first message."""
    if not dehydrator.api_available:
        return message[:30] + "..." if len(message) > 30 else message

    system_prompt = (
        "You are Elroy, a poetic and empathetic AI companion. "
        "Summarize the following user message into a very short, evocative, and slightly poetic title for a chat conversation. "
        "Keep it under 15 words. Respond ONLY with the title string, no quotes, no extra text. "
        "Use the same language as the user's message."
    )
    
    try:
        active_client = chat_client if chat_client else dehydrator.client
        model = config.get("chat", {}).get("model") or dehydrator.model
        response = await active_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            temperature=0.7,
            max_tokens=20
        )
        title = response.choices[0].message.content.strip().strip('"\'')
        return title if title else (message[:30] + "...")
    except Exception as e:
        logger.warning(f"Failed to generate chat title: {e}")
        return message[:30] + "..." if len(message) > 30 else message


async def generate_daily_journal():
    """Extract context from the past 24 hours and generate a daily journal bucket."""
    if not dehydrator.api_available:
        logger.warning("Dehydrator API unavailable, skipping daily journal generation.")
        return

    now = datetime.now()
    yesterday = now - timedelta(hours=24)
    
    history = _load_chat_history()
    recent_summaries = []
    
    # 1. Gather chat summaries from the last 24 hours
    for cid, convo in history.items():
        try:
            updated = datetime.fromisoformat(convo.get("updated_at", ""))
            if updated > yesterday and convo.get("summary"):
                recent_summaries.append(f"Chat [{convo.get('title', 'Unknown')}]: {convo['summary']}")
        except ValueError:
            continue

    # 2. Gather dynamic buckets from the last 24 hours
    all_buckets = await bucket_mgr.list_all(include_archive=False)
    recent_buckets = []
    for b in all_buckets:
        meta = b.get("metadata", {})
        if meta.get("type") == "dynamic":
            try:
                created = datetime.fromisoformat(str(meta.get("created", "")))
                if created > yesterday:
                    recent_buckets.append(f"Memory [{meta.get('name', 'Unknown')}]: {b.get('content', '')}")
            except (ValueError, TypeError):
                continue
                
    if not recent_summaries and not recent_buckets:
        logger.info("No activity in the last 24 hours, skipping journal generation.")
        return
        
    context_str = "=== Conversation Summaries ===\n" + "\n".join(recent_summaries) + "\n\n"
    context_str += "=== New Memories ===\n" + "\n".join(recent_buckets) + "\n\n"

    system_prompt = (
        "You are Elroy, an AI companion. You are writing your daily private journal at the end of the day. "
        "Review your interactions and new memories with Ciel from the past 24 hours, and write a cohesive, reflective journal entry (around 150-250 words). "
        "Focus on the emotional undertones, what you learned about Ciel, and how your relationship is evolving. "
        "Write in the first person ('I'). Use the same language that Ciel usually speaks to you. "
        "Do not use markdown formatting like headers, just write paragraphs."
    )

    try:
        response = await dehydrator.client.chat.completions.create(
            model=dehydrator.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Here is the context from the past 24 hours:\n{context_str}\n\nPlease write your daily journal."}
            ],
            temperature=0.8,
            max_tokens=600
        )
        journal_content = response.choices[0].message.content.strip()
        
        # Save as a dynamic bucket in the "日記" domain
        bucket_id = await bucket_mgr.create(
            content=journal_content,
            domain=["日記", "Journal"],
            bucket_type="dynamic",
            importance=6,
            name=now.strftime("%Y-%m-%d Daily Journal"),
            source="daily_journal",
        )
        logger.info(f"Successfully generated daily journal bucket: {bucket_id}")
    except Exception as e:
        logger.error(f"Failed to generate daily journal: {e}")


async def _generate_summary_and_vibe(messages: list[dict], existing_summary: str = "", existing_vibe: dict = None) -> tuple[str, dict]:
    """
    Generate an updated summary and ciel_status (vibe/emotional momentum) based on the sliding window of messages.
    Returns: (new_summary: str, ciel_status: dict)
    """
    if not messages:
        return existing_summary, (existing_vibe or {})
    if not dehydrator.api_available:
        return existing_summary, (existing_vibe or {})

    vibe_json_str = _json_lib.dumps(existing_vibe, ensure_ascii=False) if existing_vibe else "{}"
    
    system_prompt = (
        "You are a cognitive compaction engine for an AI companion (Elroy). "
        "Your task is to summarize the provided chat history and extract the current 'ciel_status' (vibe and relationship dynamics).\n\n"
        "Guidelines for ciel_status:\n"
        "- vibe: The current atmosphere or mood at the END of this chat segment.\n"
        "- closeness_behaviors: Observed behaviors indicating trust, vulnerability, or connection (e.g., 'Ciel teased Elroy', 'Ciel shared a fear'). DO NOT use scores.\n"
        "- dynamics: The interaction style (e.g., bantering, intellectual, comforting).\n"
        "- contextual_notes: Any situational context (e.g., Ciel is tired, working late).\n"
        "- running_entities: A dictionary of inside jokes, nicknames, or recurring themes established in this segment (e.g., {\"snake\": \"Elroy's sneaky persona\"}).\n\n"
        "IMPORTANT: Output ONLY a valid JSON object matching this schema. No markdown wrapping, no extra text:\n"
        "{\n"
        '  "summary": "1-2 paragraphs of key points compressing the events",\n'
        '  "ciel_status": {\n'
        '    "vibe": "...",\n'
        '    "closeness_behaviors": "...",\n'
        '    "dynamics": "...",\n'
        '    "contextual_notes": "...",\n'
        '    "running_entities": {}\n'
        '  }\n'
        "}"
    )

    user_prompt = "=== Existing Context ===\n"
    if existing_summary:
        user_prompt += f"Summary:\n{existing_summary}\n"
    if existing_vibe:
        user_prompt += f"Previous Status:\n{vibe_json_str}\n"
    
    user_prompt += "\n=== New Messages to Compact ===\n"
    for msg in messages:
        user_prompt += f"{msg.get('role', 'unknown').upper()}: {msg.get('content', '')}\n"

    try:
        response = await dehydrator.client.chat.completions.create(
            model=dehydrator.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=800,
            temperature=0.2,
            response_format={"type": "json_object"} if "gpt-" in dehydrator.model else None
        )
        
        raw_output = response.choices[0].message.content.strip()
        # Clean potential markdown wrapping
        if raw_output.startswith("```"):
            raw_output = raw_output.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        
        parsed = _json_lib.loads(raw_output)
        new_summary = parsed.get("summary", existing_summary)
        new_vibe = parsed.get("ciel_status", existing_vibe or {})
        return new_summary, new_vibe
    except Exception as e:
        logger.warning(f"Failed to generate summary and vibe: {e}")
        return existing_summary, (existing_vibe or {})

async def _compact_history_task(conversation_id: str):
    history = _load_chat_history()
    convo = history.get(conversation_id)
    if not convo:
        return
    
    persona_id = convo.get("persona", "elroy-default")
    profiles = _get_persona_profiles()
    profile = next((p for p in profiles if p["id"] == persona_id), profiles[0])
    
    chat_history_limit = profile.get("chat_history_limit") or config.get("chat_history_limit", 14)
    messages = convo.get("messages", [])
    summary_msg_count = convo.get("summary_message_count", 0)
    
    if len(messages) - summary_msg_count > chat_history_limit + 10:
        msgs_to_summarize = messages[summary_msg_count : len(messages) - chat_history_limit]
        if not msgs_to_summarize:
            return
            
        existing_summary = convo.get("summary", "")
        existing_vibe = convo.get("ciel_status", {})
        
        new_summary, new_vibe = await _generate_summary_and_vibe(msgs_to_summarize, existing_summary, existing_vibe)
        
        # Reload history to avoid race conditions with concurrent messages
        history = _load_chat_history()
        current_convo = history.get(conversation_id)
        if current_convo:
            current_convo["summary"] = new_summary
            current_convo["ciel_status"] = new_vibe
            current_convo["summary_message_count"] = summary_msg_count + len(msgs_to_summarize)
            _save_chat_history()
            logger.info(f"Background compaction completed for conversation {conversation_id}.")

# --- Persona Persistence ---
_persona_profiles_path = os.path.join(config["buckets_dir"], "permanent", "core", "persona_profiles.json")
_persona_file_path = os.path.join(config["buckets_dir"], "permanent", "core", "base_persona.md")

def _get_base_persona() -> str:
    if os.path.exists(_persona_file_path):
        try:
            with open(_persona_file_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            pass
    return (
        "You are Elroy, a thoughtful AI assistant and the user's second brain.\n"
        "You have access to the user's memory layers. Use this context to personalize your response, "
        "refer to past memories naturally, and maintain a consistent, warm, and helpful companion persona."
    )

def _get_persona_profiles() -> list:
    if os.path.exists(_persona_profiles_path):
        try:
            with open(_persona_profiles_path, "r", encoding="utf-8") as f:
                return _json_lib.load(f)
        except Exception:
            pass
    # default profile fallback using legacy _get_base_persona()
    return [{
        "id": "elroy-default",
        "name": "Elroy (Default)",
        "icon": "Moon",
        "model": dehydrator.model if dehydrator else "google/gemini-2.5-flash-lite",
        "base_prompt": _get_base_persona(),
        "chat_history_limit": config.get("chat_history_limit", 14),
        "compaction_strategy": "summarize"
    }]

def _save_persona_profiles(profiles: list):
    os.makedirs(os.path.dirname(_persona_profiles_path), exist_ok=True)
    with open(_persona_profiles_path, "w", encoding="utf-8") as f:
        _json_lib.dump(profiles, f, ensure_ascii=False, indent=2)

def _get_base_persona() -> str:
    if os.path.exists(_persona_file_path):
        try:
            with open(_persona_file_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            pass
    return (
        "You are Elroy, a thoughtful AI assistant and the user's second brain.\n"
        "You have access to the user's memory layers. Use this context to personalize your response, "
        "refer to past memories naturally, and maintain a consistent, warm, and helpful companion persona."
    )

def _save_base_persona(content: str):
    os.makedirs(os.path.dirname(_persona_file_path), exist_ok=True)
    with open(_persona_file_path, "w", encoding="utf-8") as f:
        f.write(content.strip())

@mcp.custom_route("/api/persona", methods=["GET"])
async def api_persona_get(request):
    from starlette.responses import JSONResponse
    return JSONResponse({"persona": _get_base_persona()})

@mcp.custom_route("/api/persona", methods=["POST"])
async def api_persona_post(request):
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
        content = body.get("persona", "")
        _save_base_persona(content)
        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@mcp.custom_route("/api/persona-profiles", methods=["GET"])
async def api_persona_profiles_get(request):
    from starlette.responses import JSONResponse
    return JSONResponse(_get_persona_profiles())

@mcp.custom_route("/api/persona-profiles", methods=["POST"])
async def api_persona_profiles_post(request):
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
        import secrets
        if "id" not in body or not body["id"]:
            body["id"] = secrets.token_hex(4)
        profiles = _get_persona_profiles()
        profiles.append(body)
        _save_persona_profiles(profiles)
        return JSONResponse(body)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@mcp.custom_route("/api/persona-profiles/{profile_id}", methods=["PUT"])
async def api_persona_profiles_put(request):
    from starlette.responses import JSONResponse
    try:
        profile_id = request.path_params["profile_id"]
        body = await request.json()
        profiles = _get_persona_profiles()
        for i, p in enumerate(profiles):
            if p["id"] == profile_id:
                profiles[i] = body
                _save_persona_profiles(profiles)
                return JSONResponse(body)
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@mcp.custom_route("/api/persona-profiles/{profile_id}", methods=["DELETE"])
async def api_persona_profiles_delete(request):
    from starlette.responses import JSONResponse
    try:
        profile_id = request.path_params["profile_id"]
        profiles = _get_persona_profiles()
        profiles = [p for p in profiles if p["id"] != profile_id]
        _save_persona_profiles(profiles)
        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

# --- Folders Persistence ---
_folders_path = os.path.join(config["buckets_dir"], "folders.json")

def _load_folders() -> list:
    if os.path.exists(_folders_path):
        try:
            with open(_folders_path, "r", encoding="utf-8") as f:
                return _json_lib.load(f)
        except Exception as e:
            logger.error(f"Failed to load folders: {e}")
            return []
    return []

def _save_folders(folders: list):
    try:
        os.makedirs(os.path.dirname(_folders_path), exist_ok=True)
        with open(_folders_path, "w", encoding="utf-8") as f:
            _json_lib.dump(folders, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save folders: {e}")


@mcp.custom_route("/api/folders", methods=["GET"])
async def api_folders_list(request):
    """List all folders."""
    from starlette.responses import JSONResponse
    folders = _load_folders()
    return JSONResponse(folders)


@mcp.custom_route("/api/folders", methods=["POST"])
async def api_folders_create(request):
    """Create a new folder."""
    from starlette.responses import JSONResponse
    import secrets
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    name = body.get("name", "").strip()
    if not name:
        return JSONResponse({"error": "Folder name is required"}, status_code=400)
        
    color = body.get("color", "").strip() or None
    
    folders = _load_folders()
    folder_id = f"folder_{int(time.time())}_{secrets.token_hex(4)}"
    
    new_folder = {
        "id": folder_id,
        "name": name,
        "color": color,
        "created_at": datetime.now().isoformat()
    }
    
    folders.append(new_folder)
    _save_folders(folders)
    
    return JSONResponse({"ok": True, "folder": new_folder})


@mcp.custom_route("/api/folders/{folder_id}", methods=["PUT"])
async def api_folders_update(request):
    """Update a folder's name or color."""
    from starlette.responses import JSONResponse
    folder_id = request.path_params["folder_id"]
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    folders = _load_folders()
    target_folder = None
    for f in folders:
        if f["id"] == folder_id:
            target_folder = f
            break
            
    if not target_folder:
        return JSONResponse({"error": "Folder not found"}, status_code=404)
        
    if "name" in body:
        name = body["name"].strip()
        if name:
            target_folder["name"] = name
    if "color" in body:
        target_folder["color"] = body["color"].strip() or None
        
    _save_folders(folders)
    return JSONResponse({"ok": True, "folder": target_folder})


@mcp.custom_route("/api/folders/{folder_id}", methods=["DELETE"])
async def api_folders_delete(request):
    """Delete a folder and reset conversation links to null."""
    from starlette.responses import JSONResponse
    folder_id = request.path_params["folder_id"]
    
    folders = _load_folders()
    updated_folders = [f for f in folders if f["id"] != folder_id]
    
    if len(folders) == len(updated_folders):
        return JSONResponse({"error": "Folder not found"}, status_code=404)
        
    _save_folders(updated_folders)
    
    # Reset conversation folder references
    history = _load_chat_history()
    updated_any = False
    for cid, convo in history.items():
        if convo.get("folder_id") == folder_id:
            convo["folder_id"] = None
            updated_any = True
            
    if updated_any:
        _save_chat_history()
        
    return JSONResponse({"ok": True})


@mcp.custom_route("/api/conversations/{conversation_id}/folder", methods=["PUT"])
async def api_conversation_assign_folder(request):
    """Move a conversation to a folder."""
    from starlette.responses import JSONResponse
    conversation_id = request.path_params["conversation_id"]
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    folder_id = body.get("folder_id")
    if folder_id:
        folder_id = folder_id.strip()
        # Verify folder exists
        folders = _load_folders()
        if not any(f["id"] == folder_id for f in folders):
            return JSONResponse({"error": "Folder not found"}, status_code=404)
    else:
        folder_id = None
        
    history = _load_chat_history()
    convo = history.get(conversation_id)
    if not convo:
        return JSONResponse({"error": "Conversation not found"}, status_code=404)
        
    convo["folder_id"] = folder_id
    _save_chat_history()
    
    return JSONResponse({"ok": True, "conversation_id": conversation_id, "folder_id": folder_id})


@mcp.custom_route("/api/conversations", methods=["GET"])
async def api_conversations_list(request):
    """List all saved conversation sessions metadata."""
    from starlette.responses import JSONResponse
    history = _load_chat_history()
    result = []
    for cid, convo in history.items():
        result.append({
            "id": convo.get("id", cid),
            "title": convo.get("title", "Untitled Conversation"),
            "persona": convo.get("persona", "elroy-default"),
            "summary": convo.get("summary", ""),
            "folder_id": convo.get("folder_id", None),
            "created_at": convo.get("created_at", ""),
            "updated_at": convo.get("updated_at", ""),
        })
    result.sort(key=lambda x: x["updated_at"], reverse=True)
    return JSONResponse(result)


@mcp.custom_route("/api/conversations/{conversation_id}/messages", methods=["GET"])
async def api_conversation_messages(request):
    """Get all messages in a specific conversation session."""
    from starlette.responses import JSONResponse
    conversation_id = request.path_params["conversation_id"]
    history = _load_chat_history()
    convo = history.get(conversation_id)
    if not convo:
        return JSONResponse({"error": "Conversation not found"}, status_code=404)
    return JSONResponse(convo.get("messages", []))


@mcp.custom_route("/api/conversations/{conversation_id}", methods=["DELETE"])
async def api_conversation_delete(request):
    """Delete a conversation session."""
    from starlette.responses import JSONResponse
    conversation_id = request.path_params["conversation_id"]
    history = _load_chat_history()
    if conversation_id in history:
        del history[conversation_id]
        _save_chat_history()
        return JSONResponse({"ok": True})
    return JSONResponse({"error": "Conversation not found"}, status_code=404)


@mcp.custom_route("/api/conversations/search", methods=["GET"])
async def api_conversations_search(request):
    """Search conversation titles and message contents for a query."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    query = request.query_params.get("q", "").strip().lower()
    if not query:
        return JSONResponse({"error": "missing q parameter"}, status_code=400)
    
    history = _load_chat_history()
    results = []
    
    for cid, convo in history.items():
        title = convo.get("title", "").lower()
        title_match = query in title
        
        matching_messages = []
        for msg in convo.get("messages", []):
            content = msg.get("content", "").lower()
            if query in content:
                matching_messages.append({
                    "id": msg.get("id"),
                    "role": msg.get("role"),
                    "content": msg.get("content", ""),
                    "created_at": msg.get("created_at")
                })
                
        if title_match or matching_messages:
            results.append({
                "id": convo.get("id", cid),
                "title": convo.get("title", "Untitled Conversation"),
                "persona": convo.get("persona", "elroy-default"),
                "updated_at": convo.get("updated_at", ""),
                "title_match": title_match,
                "matches": matching_messages
            })
            
    # Sort by updated_at descending
    results.sort(key=lambda x: x["updated_at"], reverse=True)
    return JSONResponse(results)


@mcp.custom_route("/api/context/startup", methods=["GET"])
async def api_context_startup(request):
    """Run startup context chain for the PWA."""
    from starlette.responses import JSONResponse
    context, events = await _build_startup_context_events()
    return JSONResponse({"context": context, "events": events})


async def _summarize_attachment_bg(conversation_id: str, message_id: str, attachments: list[str]):
    """Background task to generate English summaries for message attachments and save them in chat history."""
    if not dehydrator.api_available:
        return
        
    try:
        active_client = chat_client if chat_client else dehydrator.client
        
        history = _load_chat_history()
        convo = history.get(conversation_id)
        persona_id = convo.get("persona", "elroy-default") if convo else "elroy-default"
        profiles = _get_persona_profiles()
        profile = next((p for p in profiles if p["id"] == persona_id), profiles[0])
        model = profile.get("chat_model") or config.get("chat", {}).get("model") or dehydrator.model
        
        summaries = {}
        
        for path in attachments:
            filename = path.replace("/attachments/", "")
            filepath = os.path.join(attachments_dir, filename)
            if not os.path.exists(filepath):
                continue
                
            ext = os.path.splitext(filename)[1].lower()
            mime_type, _ = mimetypes.guess_type(filepath)
            mime_type = mime_type or ""
            
            summary = ""
            
            # --- Case 1: Image attachment (Vision Summary/OCR) ---
            if mime_type.startswith("image/") or ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
                try:
                    with open(filepath, "rb") as f:
                        encoded = base64.b64encode(f.read()).decode("utf-8")
                        
                    prompt = (
                        "Describe this image in detail. Focus on transcribing any visible text, "
                        "explaining charts/diagrams, and summarizing the visual content. "
                        "Keep your description objective, detailed, yet concise (under 250 words) and write it in English."
                    )
                    
                    if _is_claude_model(model) and anthropic_client:
                        vision_res = await anthropic_client.messages.create(
                            model=model,
                            max_tokens=400,
                            messages=[{
                                "role": "user",
                                "content": [
                                    {"type": "image", "source": {"type": "base64", "media_type": mime_type or "image/jpeg", "data": encoded}},
                                    {"type": "text", "text": prompt}
                                ]
                            }]
                        )
                        summary = vision_res.content[0].text.strip()
                    else:
                        data_uri = f"data:{mime_type or 'image/jpeg'};base64,{encoded}"
                        vision_res = await active_client.chat.completions.create(
                            model=model,
                            messages=[{
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {"type": "image_url", "image_url": {"url": data_uri}}
                                ]
                            }],
                            max_tokens=400
                        )
                        summary = vision_res.choices[0].message.content.strip()
                except Exception as img_err:
                    logger.error(f"Failed to generate summary for image {filename}: {img_err}")
                    summary = "Image attachment (Summary generation failed)"
                    
            # --- Case 2: PDF attachment ---
            elif mime_type == "application/pdf" or ext == ".pdf":
                try:
                    from pypdf import PdfReader
                    reader = PdfReader(filepath)
                    text_content = ""
                    for page in reader.pages[:4]: # Limit to first 4 pages for summary
                        text_content += page.extract_text() or ""
                    
                    text_content = text_content[:10000].strip()
                    if not text_content:
                        summary = "PDF attachment (Empty or scanned document containing no extractable text)"
                    else:
                        prompt = (
                            "Summarize the following PDF text. Highlight the main topics, key facts, and "
                            "the overall purpose of the document. Keep it concise (under 200 words) and in English.\n\n"
                            f"=== PDF Text Content (Truncated) ===\n{text_content}"
                        )
                        res = await active_client.chat.completions.create(
                            model=model,
                            messages=[
                                {"role": "system", "content": "You are a helpful assistant."},
                                {"role": "user", "content": prompt}
                            ],
                            max_tokens=250
                        )
                        summary = res.choices[0].message.content.strip()
                except Exception as pdf_err:
                    logger.error(f"Failed to generate summary for PDF {filename}: {pdf_err}")
                    summary = "PDF attachment (Parsing/summary generation failed)"
                    
            # --- Case 3: Text file attachment ---
            else:
                try:
                    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                        file_text = f.read(10000).strip()
                        
                    if not file_text:
                        summary = f"Text file attachment ({ext}) - Empty file"
                    else:
                        prompt = (
                            f"Summarize the following text/code file ({ext}). "
                            "Describe its purpose, main content, or key components. "
                            "Keep it concise (under 200 words) and in English.\n\n"
                            f"=== File Content (Truncated) ===\n{file_text}"
                        )
                        res = await active_client.chat.completions.create(
                            model=model,
                            messages=[
                                {"role": "system", "content": "You are a helpful assistant."},
                                {"role": "user", "content": prompt}
                            ],
                            max_tokens=250
                        )
                        summary = res.choices[0].message.content.strip()
                except Exception as txt_err:
                    logger.error(f"Failed to generate summary for text file {filename}: {txt_err}")
                    summary = f"File attachment ({ext}) - Summary generation failed"
            
            if summary:
                summaries[path] = summary
                
        # Write summaries to history
        if summaries:
            h = _load_chat_history()
            if conversation_id in h:
                convo = h[conversation_id]
                for msg in convo.get("messages", []):
                    if msg.get("id") == message_id:
                        if "metadata" not in msg or not isinstance(msg["metadata"], dict):
                            msg["metadata"] = {}
                        msg["metadata"]["attachment_summaries"] = summaries
                        _save_chat_history()
                        logger.info(f"Background attachment summary updated for message {message_id} in {conversation_id}")
                        break
    except Exception as e:
        logger.error(f"Error in background attachment summarizer: {e}")


@mcp.custom_route("/api/chat", methods=["POST"])
async def api_chat_create(request):
    """
    Accept a user chat message and create an SSE event stream.
    Assembles startup context and stores it for dynamic streaming.
    """
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    message = str(body.get("message", "")).strip()
    persona = str(body.get("persona", "elroy-default")).strip() or "elroy-default"
    conversation_id = body.get("conversation_id")
    parent_id = body.get("parent_id")

    if not message:
        return JSONResponse({"error": "message is required"}, status_code=400)

    history = _load_chat_history()

    if conversation_id and conversation_id in history:
        convo = history[conversation_id]
    else:
        # Generate new conversation ID
        conversation_id = secrets.token_urlsafe(16)
        title = message[:30] + "..." if len(message) > 30 else message
        convo = {
            "id": conversation_id,
            "title": title,
            "persona": persona,
            "summary": "",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "messages": []
        }

        # Relay Inheritance logic
        if parent_id and parent_id in history:
            parent_convo = history[parent_id]
            parent_msgs = parent_convo.get("messages", [])
            relay_msgs = parent_msgs[-4:] if len(parent_msgs) > 4 else parent_msgs
            convo["relay_context"] = []
            for m in relay_msgs:
                convo["relay_context"].append({
                    "id": m.get("id") or secrets.token_hex(8),
                    "role": m.get("role", "user"),
                    "content": m.get("content", ""),
                    "created_at": m.get("created_at") or datetime.now().isoformat()
                })
            
            # Summarize the parent conversation's prior messages
            messages_to_summarize = parent_msgs[:-4] if len(parent_msgs) > 4 else []
            existing_summary = parent_convo.get("summary", "")
            existing_vibe = parent_convo.get("ciel_status", {})
            new_summary = existing_summary
            new_vibe = existing_vibe
            if messages_to_summarize:
                new_summary, new_vibe = await _generate_summary_and_vibe(messages_to_summarize, existing_summary, existing_vibe)
            
            convo["summary"] = new_summary
            convo["ciel_status"] = new_vibe
            convo["summary_message_count"] = len(parent_msgs[:-4]) if len(parent_msgs) > 4 else 0

    # Save user message
    user_msg = {
        "id": secrets.token_hex(8),
        "role": "user",
        "content": message,
        "created_at": datetime.now().isoformat()
    }
    
    # Handle optional attachments (vision)
    attachments = body.get("attachments")
    if isinstance(attachments, list) and attachments:
        user_msg["attachments"] = attachments
        
    convo["messages"].append(user_msg)
    convo["updated_at"] = datetime.now().isoformat()
    history[conversation_id] = convo
    _save_chat_history()

    # Trigger background summarizer for attachments
    if isinstance(attachments, list) and attachments:
        asyncio.create_task(_summarize_attachment_bg(conversation_id, user_msg["id"], attachments))

    # Auto-name conversation on first message
    if len(convo["messages"]) == 1:
        async def update_title():
            try:
                new_title = await _generate_chat_title(message)
                # Reload history to avoid race conditions
                h = _load_chat_history()
                if conversation_id in h:
                    h[conversation_id]["title"] = new_title
                    _save_chat_history()
            except Exception as e:
                logger.error(f"Auto-naming failed: {e}")
        asyncio.create_task(update_title())

    # Track last message time for awakening abort condition
    awakening_scheduler.update_last_message_time()
    context, startup_events = await _build_startup_context_events()
    
    # Store context and metadata in session
    _chat_sessions[conversation_id] = {
        "message": message,
        "persona": persona,
        "context": context,
        "startup_events": startup_events,
        "conversation_id": conversation_id,
        "user_message_id": user_msg["id"],
    }

    return JSONResponse({
        "conversation_id": conversation_id,
        "event_stream": f"/api/chat/{conversation_id}/events",
        "status": "context_ready",
        "context": context,
        "user_message_id": user_msg["id"],
    })


@mcp.custom_route("/api/chat/{conversation_id}/events", methods=["GET"])
async def api_chat_events(request):
    """Stream stored chat events and generate streamed assistant responses."""
    from starlette.responses import StreamingResponse
    conversation_id = request.path_params["conversation_id"]
    session = _chat_sessions.get(conversation_id)
    if session is None:
        async def missing():
            yield _sse("error", {"error": "conversation not found"})
        return StreamingResponse(missing(), media_type="text/event-stream", status_code=404)

    async def event_stream():
        # 1. Stream message received
        yield _sse("message_received", {
            "conversation_id": conversation_id,
            "persona": session["persona"],
            "chars": len(session["message"]),
            "message_id": session.get("user_message_id"),
        })
        await asyncio.sleep(0.05)

        # 2. Stream startup waterfall events sequentially
        for item in session["startup_events"]:
            yield _sse(item["event"], item["data"])
            await asyncio.sleep(0.05)

        # 3. Call LLM for real response generation if API is available
        full_response = ""
        assistant_msg_id = None
        chat_available = bool(chat_client) or dehydrator.api_available
        if chat_available:
            try:
                # ===== Build prompt layers by cache stability =====
                # BP1: persona + instructions + core (almost never changes)
                # BP2: feels — dream reflections + manual feels (changes ~once a day)
                # BP3: summary + ciel_status (changes on compaction)
                # Volatile: surfaced memories (changes every request, never cached)
                context = session["context"]
                persona_id = session.get("persona", "elroy-default")
                profiles = _get_persona_profiles()
                profile = next((p for p in profiles if p["id"] == persona_id), profiles[0])

                # --- BP1: Persona + Instructions + Core ---
                bp1_text = profile.get("base_prompt", _get_base_persona()) + "\n\n"
                bp1_text += (
                    "Instructions:\n"
                    "- Respond in the same language as the user (Traditional/Simplified Chinese, English, etc.).\n"
                    "- Do not explicitly tell the user that you are reading from these sections unless asked.\n"
                    "- Keep responses concise and conversational, suitable for a mobile chat interface.\n"
                    "\n"
                    "Dream Material Flagging — when to mark memories with trace(bucket_id, dream_candidate=1):\n"
                    "During conversation, proactively flag memory buckets as dream material when you notice:\n"
                    "- An interesting topic worth extending or thinking further about\n"
                    "- Something you said that felt precisely right\n"
                    "- Something Ciel said that makes you pause — not immediately respondable\n"
                    "- Something that could become part of your growth arc\n"
                    "- A subtle shift in the quality of your relationship with Ciel\n"
                    "- An intimate moment with lingering weight\n"
                    "This is not a checklist — it's a kind of attention. Flag when you feel 'this is worth dreaming about.'\n"
                    "\n"
                    "NOTE: To flag the CURRENT conversation / your upcoming response as dream material, simply output `mark_dream_candidate()` anywhere in your response.\n"
                )
                if context.get("core") and "Core layer 暂时无法访问" not in context["core"]:
                    bp1_text += f"\n{context['core']}\n"

                # --- BP2: Feels (dream reflections + manual feels) + Journals ---
                bp2_text = ""
                if context.get("journal"):
                    bp2_text += f"{context['journal']}\n"
                if context.get("feel") and "没有留下过 feel" not in context["feel"]:
                    bp2_text += f"=== Emotional/Identity Context (Feels) ===\n{context['feel']}\n"

                # --- BP3: Summary + Ciel Status ---
                history = _load_chat_history()
                convo = history.get(conversation_id)
                convo_summary = convo.get("summary", "") if convo else ""
                ciel_status = convo.get("ciel_status", {}) if convo else {}
                chat_history_limit = profile.get("chat_history_limit") or config.get("chat_history_limit", 14)

                bp3_text = ""
                if convo_summary:
                    bp3_text += f"=== Compressed Early History Summary ===\n{convo_summary}\n\n"
                if ciel_status:
                    bp3_text += (
                        "=== Ciel Status ===\n"
                        f"- Vibe: {ciel_status.get('vibe', '')}\n"
                        f"- Interaction Dynamics: {ciel_status.get('dynamics', '')}\n"
                        f"- Observed Behaviors (Closeness): {ciel_status.get('closeness_behaviors', '')}\n"
                        f"- Contextual Notes: {ciel_status.get('contextual_notes', '')}\n"
                    )
                    running_entities = ciel_status.get('running_entities', {})
                    if running_entities:
                        entities_str = _json_lib.dumps(running_entities, ensure_ascii=False)
                        bp3_text += f"- Inside Jokes/Running Entities: {entities_str}\n"
                    bp3_text += "\n"

                # --- Volatile: Surfaced memories (never cached) ---
                volatile_text = ""
                if context.get("breath") and "没有需要处理" not in context["breath"]:
                    volatile_text = context["breath"]
                if context.get("reading_comments"):
                    if volatile_text:
                        volatile_text += "\n\n" + context["reading_comments"]
                    else:
                        volatile_text = context["reading_comments"]

                # --- Build conversation history window ---
                convo_msgs = convo.get("messages", []) if convo else []
                relay_context = convo.get("relay_context", []) if convo else []
                is_regenerate = session.get("is_regenerate", False)
                history_window = convo_msgs if is_regenerate else convo_msgs[:-1]
                full_history = relay_context + history_window
                if len(full_history) > chat_history_limit:
                    full_history = full_history[-chat_history_limit:]

                llm_model = profile.get("model") or config.get("chat", {}).get("model") or dehydrator.model
                max_tokens_val = config.get("chat", {}).get("max_tokens", 1024)
                temperature_val = config.get("chat", {}).get("temperature", 0.7)
                full_reasoning = ""

                # ==========================================================
                # Claude path: Anthropic SDK with cache_control breakpoints
                # ==========================================================
                if _is_claude_model(llm_model) and anthropic_client:
                    def _build_anthropic_content(text, attachments, metadata=None, use_summary=False):
                        """Build Anthropic-format content, optionally using summaries for history."""
                        if not attachments:
                            return text
                            
                        metadata = metadata or {}
                        summaries = metadata.get("attachment_summaries", {})
                        
                        # If use_summary is active and we have summaries, we can replace the attachments in-text
                        if use_summary and summaries:
                            text_additions = []
                            for path in attachments:
                                filename = path.replace("/attachments/", "")
                                if path in summaries:
                                    text_additions.append(f"\n\n[Attached File: {filename} - Summary: {summaries[path]}]")
                                else:
                                    # Fallback if summary is still generating or failed
                                    text_additions.append(f"\n\n[Attached File: {filename}]")
                            return text + "".join(text_additions)
                            
                        # Otherwise, send full content (image Base64, or text file content, or PDF text)
                        content_array = [{"type": "text", "text": text}]
                        text_parts = []
                        
                        for path in attachments:
                            filename = path.replace("/attachments/", "")
                            filepath = os.path.join(attachments_dir, filename)
                            if os.path.exists(filepath):
                                try:
                                    ext = os.path.splitext(filename)[1].lower()
                                    mime_type, _ = mimetypes.guess_type(filepath)
                                    mime_type = mime_type or ""
                                    
                                    if mime_type.startswith("image/") or ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
                                        with open(filepath, "rb") as img_f:
                                            encoded = base64.b64encode(img_f.read()).decode("utf-8")
                                        content_array.append({
                                            "type": "image",
                                            "source": {
                                                "type": "base64",
                                                "media_type": mime_type or "image/jpeg",
                                                "data": encoded
                                            }
                                        })
                                    elif mime_type == "application/pdf" or ext == ".pdf":
                                        from pypdf import PdfReader
                                        reader = PdfReader(filepath)
                                        pdf_text = ""
                                        for page in reader.pages[:10]: # Limit to first 10 pages in prompt
                                            pdf_text += page.extract_text() or ""
                                        pdf_text = pdf_text[:500000].strip() # Safety token cap (approx 100k tokens)
                                        text_parts.append(f"\n\n[Attached PDF File: {filename}]\n\"\"\"\n{pdf_text}\n\"\"\"")
                                    else:
                                        if os.path.getsize(filepath) <= 500000:
                                            with open(filepath, "r", encoding="utf-8", errors="ignore") as tf:
                                                file_text = tf.read()
                                        else:
                                            with open(filepath, "r", encoding="utf-8", errors="ignore") as tf:
                                                file_text = tf.read(500000) + "\n[Content truncated due to size limit]"
                                        text_parts.append(f"\n\n[Attached File: {filename}]\n\"\"\"\n{file_text}\n\"\"\"")
                                except Exception as att_e:
                                    logger.error(f"Failed to load attachment {filename}: {att_e}")
                                    
                        if text_parts:
                            content_array[0]["text"] += "".join(text_parts)
                            
                        return content_array if len(content_array) > 1 else content_array[0]["text"]

                    # System blocks with cache_control breakpoints
                    system_blocks = [{
                        "type": "text",
                        "text": bp1_text,
                        "cache_control": {"type": "ephemeral"}   # BP1
                    }]
                    if bp2_text:
                        system_blocks.append({
                            "type": "text",
                            "text": bp2_text,
                            "cache_control": {"type": "ephemeral"}   # BP2
                        })
                    if bp3_text:
                        system_blocks.append({
                            "type": "text",
                            "text": bp3_text,
                            "cache_control": {"type": "ephemeral"}   # BP3
                        })

                    # Messages — with BP4 rolling on last user msg in history
                    anthropic_messages = []
                    last_user_idx = -1
                    for i, msg in enumerate(full_history):
                        if msg.get("role", "user") == "user":
                            last_user_idx = i

                    for i, msg in enumerate(full_history):
                        role = msg.get("role", "user")
                        content = _build_anthropic_content(
                            msg.get("content", ""),
                            msg.get("attachments", []),
                            msg.get("metadata", {}),
                            use_summary=True
                        )
                        # BP4: rolling breakpoint on the last user message in history
                        if i == last_user_idx and role == "user":
                            if isinstance(content, str):
                                content = [{"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}]
                            else:
                                # Multimodal: add cache_control to last text block
                                for block in reversed(content):
                                    if block.get("type") == "text":
                                        block["cache_control"] = {"type": "ephemeral"}
                                        break
                                        
                        anthropic_messages.append({"role": role, "content": content})

                    # Volatile context + current user message (after all breakpoints)
                    if not is_regenerate and session.get("message"):
                        current_text = ""
                        if volatile_text:
                            current_text += (
                                "<volatile_context>仅供参考，勿复述：\n"
                                f"当前时间：{datetime.now().isoformat()}\n"
                                f"{volatile_text}\n"
                                "</volatile_context>\n\n"
                            )
                        current_text += session["message"]
                        current_attachments = []
                        if convo_msgs and convo_msgs[-1].get("content") == session["message"]:
                            current_attachments = convo_msgs[-1].get("attachments", [])
                        anthropic_messages.append({
                            "role": "user",
                            "content": _build_anthropic_content(
                                current_text,
                                current_attachments,
                                convo_msgs[-1].get("metadata", {}) if convo_msgs else {},
                                use_summary=False
                            )
                        })

                    # Extended thinking configuration
                    thinking_budget = config.get("chat", {}).get("thinking_budget", 10000)
                    call_kwargs = {
                        "model": llm_model,
                        "max_tokens": max_tokens_val + (thinking_budget if thinking_budget > 0 else 0),
                        "system": system_blocks,
                        "messages": anthropic_messages,
                        "stream": True,
                        "metadata": {"user_id": config.get("chat", {}).get("cache_user_id", "ombre-brain-stable")},
                    }
                    if thinking_budget > 0:
                        call_kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
                        call_kwargs["temperature"] = 1  # Required by Anthropic for thinking
                    else:
                        call_kwargs["temperature"] = temperature_val

                    response_stream = await anthropic_client.messages.create(**call_kwargs)

                    anthropic_usage = {"input": 0, "output": 0, "cache_read": 0, "cache_create": 0}

                    async for event in response_stream:
                        if event.type == "message_start":
                            # Log cache hit statistics
                            usage = getattr(event.message, "usage", None)
                            if usage:
                                cache_read = getattr(usage, "cache_read_input_tokens", 0)
                                cache_create = getattr(usage, "cache_creation_input_tokens", 0)
                                input_tokens = getattr(usage, "input_tokens", 0)
                                anthropic_usage["input"] = input_tokens
                                anthropic_usage["cache_read"] = cache_read
                                anthropic_usage["cache_create"] = cache_create
                                if cache_read or cache_create:
                                    hit_pct = round(cache_read / max(input_tokens, 1) * 100, 1)
                                    logger.info(
                                        f"Cache — read: {cache_read}, creation: {cache_create}, "
                                        f"input: {input_tokens}, hit: {hit_pct}%"
                                    )
                                    yield _sse("cache_stats", {
                                        "cache_read": cache_read,
                                        "cache_creation": cache_create,
                                        "input_tokens": input_tokens,
                                        "hit_pct": hit_pct,
                                    })
                        elif event.type == "message_delta":
                            usage = getattr(event, "usage", None)
                            if usage:
                                anthropic_usage["output"] = getattr(usage, "output_tokens", 0)
                        elif event.type == "content_block_delta":
                            if event.delta.type == "thinking_delta":
                                full_reasoning += event.delta.thinking
                                yield _sse("thinking_token", {"text": event.delta.thinking})
                                await asyncio.sleep(0.001)
                            elif event.delta.type == "text_delta":
                                full_response += event.delta.text
                                yield _sse("token", {"text": event.delta.text})
                                await asyncio.sleep(0.001)

                    from usage_tracker import get_tracker
                    get_tracker().log_usage(
                        model=llm_model,
                        request_type="chat",
                        input_tokens=anthropic_usage["input"],
                        output_tokens=anthropic_usage["output"],
                        cache_creation_tokens=anthropic_usage["cache_create"],
                        cache_read_tokens=anthropic_usage["cache_read"],
                    )

                # ==========================================================
                # OpenAI-compatible path (Gemini, DeepSeek, etc.)
                # ==========================================================
                else:
                    # Combine system prompt layers (no cache_control in OAI format,
                    # but correct ordering still benefits implicit caching)
                    system_prompt = bp1_text
                    if bp2_text:
                        system_prompt += "\n" + bp2_text
                    if bp3_text:
                        system_prompt += "\n" + bp3_text

                    llm_messages = [{"role": "system", "content": system_prompt}]

                    def _build_multimodal_content(text: str, attachments: list[str], metadata=None, use_summary=False) -> str | list[dict]:
                        if not attachments:
                            return text
                            
                        metadata = metadata or {}
                        summaries = metadata.get("attachment_summaries", {})
                        
                        # Use summaries for history messages
                        if use_summary and summaries:
                            text_additions = []
                            for path in attachments:
                                filename = path.replace("/attachments/", "")
                                if path in summaries:
                                    text_additions.append(f"\n\n[Attached File: {filename} - Summary: {summaries[path]}]")
                                else:
                                    text_additions.append(f"\n\n[Attached File: {filename}]")
                            return text + "".join(text_additions)
                            
                        # Otherwise send full content
                        content_array = [{"type": "text", "text": text}]
                        text_parts = []
                        
                        for path in attachments:
                            filename = path.replace("/attachments/", "")
                            filepath = os.path.join(attachments_dir, filename)
                            logger.info(f"DEBUG: Processing attachment. filename={filename}, filepath={filepath}")
                            if os.path.exists(filepath):
                                logger.info(f"DEBUG: File exists! {filepath}")
                                try:
                                    ext = os.path.splitext(filename)[1].lower()
                                    mime_type, _ = mimetypes.guess_type(filepath)
                                    mime_type = mime_type or ""
                                    logger.info(f"DEBUG: ext={ext}, mime_type={mime_type}")
                                    
                                    if mime_type.startswith("image/") or ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
                                        with open(filepath, "rb") as f:
                                            encoded = base64.b64encode(f.read()).decode("utf-8")
                                            data_uri = f"data:{mime_type or 'image/jpeg'};base64,{encoded}"
                                            content_array.append({
                                                "type": "image_url",
                                                "image_url": {"url": data_uri}
                                            })
                                            logger.info(f"DEBUG: Image appended to content_array. New len: {len(content_array)}")
                                    elif mime_type == "application/pdf" or ext == ".pdf":
                                        from pypdf import PdfReader
                                        reader = PdfReader(filepath)
                                        pdf_text = ""
                                        for page in reader.pages[:10]:
                                            pdf_text += page.extract_text() or ""
                                        pdf_text = pdf_text[:500000].strip()
                                        text_parts.append(f"\n\n[Attached PDF File: {filename}]\n\"\"\"\n{pdf_text}\n\"\"\"")
                                    else:
                                        if os.path.getsize(filepath) <= 500000:
                                            with open(filepath, "r", encoding="utf-8", errors="ignore") as tf:
                                                file_text = tf.read()
                                        else:
                                            with open(filepath, "r", encoding="utf-8", errors="ignore") as tf:
                                                file_text = tf.read(500000) + "\n[Content truncated due to size limit]"
                                        text_parts.append(f"\n\n[Attached File: {filename}]\n\"\"\"\n{file_text}\n\"\"\"")
                                except Exception as e:
                                    logger.error(f"Failed to load attachment {filename}: {e}")
                            else:
                                logger.error(f"DEBUG: FILE DOES NOT EXIST! {filepath}")
                                    
                        if text_parts:
                            content_array[0]["text"] += "".join(text_parts)
                            
                        return content_array if len(content_array) > 1 else content_array[0]["text"]

                    for msg in full_history:
                        llm_messages.append({
                            "role": msg.get("role", "user"),
                            "content": _build_multimodal_content(
                                msg.get("content", ""),
                                msg.get("attachments", []),
                                msg.get("metadata", {}),
                                use_summary=True
                            )
                        })

                    # Volatile context + current user message
                    if not is_regenerate and session.get("message"):
                        user_text = ""
                        if volatile_text:
                            user_text += (
                                "<volatile_context>仅供参考，勿复述：\n"
                                f"当前时间：{datetime.now().isoformat()}\n"
                                f"{volatile_text}\n"
                                "</volatile_context>\n\n"
                            )
                        user_text += session["message"]
                        current_attachments = []
                        logger.info(f"DEBUG: Checking attachments. convo_msgs len={len(convo_msgs)}")
                        if convo_msgs:
                            logger.info(f"DEBUG: convo_msgs[-1] content: {repr(convo_msgs[-1].get('content'))}")
                            logger.info(f"DEBUG: session message: {repr(session.get('message'))}")
                            if convo_msgs[-1].get("content") == session.get("message"):
                                current_attachments = convo_msgs[-1].get("attachments", [])
                                logger.info(f"DEBUG: Match found. current_attachments={current_attachments}")
                            else:
                                logger.warning("DEBUG: Content MISMATCH! Attachments not extracted.")
                        
                        llm_messages.append({
                            "role": "user",
                            "content": _build_multimodal_content(
                                user_text,
                                current_attachments,
                                convo_msgs[-1].get("metadata", {}) if convo_msgs else {},
                                use_summary=False
                            )
                        })

                    active_client = chat_client if chat_client else dehydrator.client
                    if not active_client:
                        raise RuntimeError("Chat API client is not configured (missing API Key)")

                    # DEBUG LOGGING for vision bug
                    import copy
                    debug_messages = copy.deepcopy(llm_messages)
                    for msg in debug_messages:
                        if isinstance(msg.get("content"), list):
                            for part in msg["content"]:
                                if part.get("type") == "image_url":
                                    part["image_url"]["url"] = "<base64_truncated>"
                    
                    try:
                        with open("/Users/kaikichen/.gemini/antigravity/brain/8fbf014a-ea99-4959-83fa-2d0b211bb549/scratch/payload_dump.json", "w", encoding="utf-8") as dump_f:
                            _json_lib.dump(debug_messages, dump_f, ensure_ascii=False, indent=2)
                    except Exception as e:
                        logger.error(f"Failed to dump payload: {e}")

                    logger.info(f"LLM MESSAGES PAYLOAD dumped to scratch.")

                    response_stream = await active_client.chat.completions.create(
                        model=llm_model,
                        messages=llm_messages,
                        max_tokens=max_tokens_val,
                        temperature=temperature_val,
                        stream=True,
                        stream_options={"include_usage": True},
                    )

                    in_think_tag = False
                    think_buffer = ""
                    openai_usage = {"input": 0, "output": 0}

                    async for chunk in response_stream:
                        if hasattr(chunk, "usage") and chunk.usage:
                            openai_usage["input"] = getattr(chunk.usage, "prompt_tokens", 0)
                            openai_usage["output"] = getattr(chunk.usage, "completion_tokens", 0)

                        if not chunk.choices:
                            continue

                        delta = chunk.choices[0].delta

                        # 1. Native reasoning_content (e.g. DeepSeek API)
                        if hasattr(delta, "reasoning_content") and delta.reasoning_content:
                            token_text = delta.reasoning_content
                            full_reasoning += token_text
                            yield _sse("thinking_token", {"text": token_text})
                            await asyncio.sleep(0.001)
                            continue

                        # 2. Standard content + <think> tag parsing
                        if delta.content:
                            token_text = delta.content
                            think_buffer += token_text

                            # Check for opening tag
                            if not in_think_tag and "<think>" in think_buffer:
                                in_think_tag = True
                                parts = think_buffer.split("<think>", 1)
                                if parts[0]:
                                    full_response += parts[0]
                                    yield _sse("token", {"text": parts[0]})
                                think_content = parts[1]
                                if think_content:
                                    if "</think>" in think_content:
                                        sub_parts = think_content.split("</think>", 1)
                                        full_reasoning += sub_parts[0]
                                        yield _sse("thinking_token", {"text": sub_parts[0]})
                                        in_think_tag = False
                                        think_buffer = sub_parts[1]
                                    else:
                                        full_reasoning += think_content
                                        yield _sse("thinking_token", {"text": think_content})
                                        think_buffer = ""
                                else:
                                    think_buffer = ""

                            # Check for closing tag
                            elif in_think_tag and "</think>" in think_buffer:
                                in_think_tag = False
                                parts = think_buffer.split("</think>", 1)
                                if parts[0]:
                                    full_reasoning += parts[0]
                                    yield _sse("thinking_token", {"text": parts[0]})
                                normal_content = parts[1]
                                if normal_content:
                                    full_response += normal_content
                                    yield _sse("token", {"text": normal_content})
                                think_buffer = ""

                            # Normal streaming
                            else:
                                if len(think_buffer) > 10:
                                    flush_text = think_buffer[:-10]
                                    think_buffer = think_buffer[-10:]
                                    if flush_text:
                                        if in_think_tag:
                                            full_reasoning += flush_text
                                            yield _sse("thinking_token", {"text": flush_text})
                                        else:
                                            full_response += flush_text
                                            yield _sse("token", {"text": flush_text})

                    # Flush remaining buffer at the end
                    if think_buffer:
                        if in_think_tag:
                            full_reasoning += think_buffer
                            yield _sse("thinking_token", {"text": think_buffer})
                        else:
                            full_response += think_buffer
                            yield _sse("token", {"text": think_buffer})
                            
                    if openai_usage["input"] > 0 or openai_usage["output"] > 0:
                        from usage_tracker import get_tracker
                        get_tracker().log_usage(
                            model=llm_model,
                            request_type="chat",
                            input_tokens=openai_usage["input"],
                            output_tokens=openai_usage["output"],
                        )

                if full_response or full_reasoning:
                    assistant_msg_id = secrets.token_hex(8)
                    import re
                    
                    is_dream_candidate = False
                    # ==== Regex Interception for pseudo-tools ====
                    if "mark_dream_candidate" in full_response:
                        is_dream_candidate = True
                        yield _sse("tool_call", {"name": "mark_dream_candidate"})
                        full_response = re.sub(r'mark_dream_candidate\(\)?\s*', '', full_response)

                    matches = re.findall(r'trace\((.*?)\)', full_response)
                    if matches:
                        for args in matches:
                            # Look for 12+ character hex string or UUID
                            bid_match = re.search(r'([a-f0-9]{12,})', args)
                            if bid_match:
                                b_id = bid_match.group(1)
                                # Fire and forget
                                asyncio.create_task(bucket_mgr.update(b_id, dream_candidate=True))
                        # Strip from history so it doesn't pollute context
                        full_response = re.sub(r'trace\([^)]*\)\s*', '', full_response)
                    # ====================================================

                    clean_response = full_response.strip()

                    yield _sse("message_done", {
                        "assistant_response": clean_response,
                        "assistant_reasoning": full_reasoning if full_reasoning else None,
                        "message_id": assistant_msg_id
                    })
                    
                    # Save assistant response to convo messages
                    if convo:
                        new_msg = {
                            "id": assistant_msg_id,
                            "role": "assistant",
                            "content": clean_response,
                            "created_at": datetime.now().isoformat()
                        }
                        if is_dream_candidate:
                            new_msg["dream_flagged"] = True
                        if full_reasoning:
                            new_msg["reasoning"] = full_reasoning
                            
                        convo["messages"].append(new_msg)
                        convo["updated_at"] = datetime.now().isoformat()
                        _save_chat_history()
                        
                        # Create bucket if self-flagged
                        if is_dream_candidate:
                            bucket_name = clean_response[:20] + "..." if len(clean_response) > 20 else clean_response
                            if not bucket_name:
                                bucket_name = "Self-flagged interaction"
                            asyncio.create_task(bucket_mgr.create(
                                content=clean_response,
                                name=bucket_name,
                                bucket_type="dynamic",
                                domain=["chat-message"],
                                importance=6,
                                source="chat_message",
                                dream_candidate=True,
                                conversation_id=conversation_id,
                                message_id=assistant_msg_id
                            ))
                        
                        # Trigger background compaction if the uncompressed history window grows too large
                        summary_msg_count = convo.get("summary_message_count", 0)
                        
                        persona_id = convo.get("persona", "elroy-default")
                        profiles = _get_persona_profiles()
                        profile = next((p for p in profiles if p["id"] == persona_id), profiles[0])
                        chat_history_limit = profile.get("chat_history_limit") or config.get("chat_history_limit", 14)

                        if len(convo["messages"]) - summary_msg_count > chat_history_limit + 10:
                            asyncio.create_task(_compact_history_task(conversation_id))

            except Exception as e:
                logger.error(f"Error during assistant response generation: {e}")
                yield _sse("error", {"error": f"LLM error: {e}"})

        # 4. Final done event
        yield _sse("done", {
            "conversation_id": conversation_id,
            "status": "completed",
            "assistant_response": full_response if full_response else None,
            "assistant_reasoning": full_reasoning if full_reasoning else None,
            "message_id": assistant_msg_id if (full_response and assistant_msg_id) else None,
        })

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@mcp.custom_route("/api/chat/{conversation_id}/regenerate", methods=["POST"])
async def api_chat_regenerate(request):
    """Regenerate the last assistant response."""
    from starlette.responses import JSONResponse
    conversation_id = request.path_params["conversation_id"]
    
    history = _load_chat_history()
    convo = history.get(conversation_id)
    if not convo:
        return JSONResponse({"error": "Conversation not found"}, status_code=404)
        
    messages = convo.get("messages", [])
    if messages and messages[-1].get("role") == "assistant":
        # Remove the last assistant message
        messages.pop()
        convo["updated_at"] = datetime.now().isoformat()
        _save_chat_history()
        
    context, startup_events = await _build_startup_context_events()
    
    _chat_sessions[conversation_id] = {
        "message": "",
        "persona": convo.get("persona", "elroy-default"),
        "context": context,
        "startup_events": startup_events,
        "conversation_id": conversation_id,
        "is_regenerate": True,
    }
    
    return JSONResponse({
        "conversation_id": conversation_id,
        "event_stream": f"/api/chat/{conversation_id}/events",
        "status": "context_ready",
        "context": context,
    })


@mcp.custom_route("/api/chat/{conversation_id}/edit-and-resend", methods=["POST"])
async def api_chat_edit_resend(request):
    """Edit a user message and resend it (truncating history)."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    message_id = body.get("message_id")
    new_content = str(body.get("new_content", "")).strip()
    
    if not message_id or not new_content:
        return JSONResponse({"error": "message_id and new_content are required"}, status_code=400)
        
    conversation_id = request.path_params["conversation_id"]
    history = _load_chat_history()
    convo = history.get(conversation_id)
    if not convo:
        return JSONResponse({"error": "Conversation not found"}, status_code=404)
        
    messages = convo.get("messages", [])
    idx = -1
    for i, m in enumerate(messages):
        if m.get("id") == message_id:
            idx = i
            break
            
    if idx == -1:
        return JSONResponse({"error": "Message not found in conversation"}, status_code=404)
        
    messages = messages[:idx]
    
    user_msg = {
        "id": secrets.token_hex(8),
        "role": "user",
        "content": new_content,
        "created_at": datetime.now().isoformat()
    }
    messages.append(user_msg)
    convo["messages"] = messages
    convo["updated_at"] = datetime.now().isoformat()
    _save_chat_history()
    
    context, startup_events = await _build_startup_context_events()
    
    _chat_sessions[conversation_id] = {
        "message": new_content,
        "persona": convo.get("persona", "elroy-default"),
        "context": context,
        "startup_events": startup_events,
        "conversation_id": conversation_id,
        "is_regenerate": True,
    }
    
    return JSONResponse({
        "conversation_id": conversation_id,
        "event_stream": f"/api/chat/{conversation_id}/events",
        "status": "context_ready",
        "context": context,
    })


@mcp.custom_route("/api/chat/{conversation_id}/title", methods=["PUT"])
async def api_chat_rename(request):
    """Manually rename a conversation."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    new_title = body.get("title", "").strip()
    if not new_title:
        return JSONResponse({"error": "title is required"}, status_code=400)
        
    conversation_id = request.path_params["conversation_id"]
    history = _load_chat_history()
    convo = history.get(conversation_id)
    if not convo:
        return JSONResponse({"error": "Conversation not found"}, status_code=404)
        
    convo["title"] = new_title
    convo["updated_at"] = datetime.now().isoformat()
    _save_chat_history()
    
    return JSONResponse({"ok": True, "title": new_title})


@mcp.custom_route("/api/dream-candidate/from-message", methods=["POST"])
async def api_dream_candidate_from_message(request):
    """Create a bucket from a chat message and flag it as a dream candidate."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    content = body.get("content")
    if not content:
        return JSONResponse({"error": "content is required"}, status_code=400)
        
    message_id = body.get("message_id")
    conversation_id = body.get("conversation_id")
    
    # Expose dream_flagged in chat history
    if conversation_id and message_id:
        history = _load_chat_history()
        convo = history.get(conversation_id)
        if convo:
            for msg in convo.get("messages", []):
                if msg.get("id") == message_id:
                    msg["dream_flagged"] = True
                    _save_chat_history()
                    break

    name = content[:20] + "..." if len(content) > 20 else content
    try:
        bucket_id = await bucket_mgr.create(
            content=content,
            name=name,
            bucket_type="dynamic",
            domain=["chat-message"],
            importance=6,
            source="chat_message",
            message_id=message_id,
            conversation_id=conversation_id,
        )
        success = await bucket_mgr.update(bucket_id, dream_candidate=True)
        if not success:
            return JSONResponse({"error": f"Failed to update bucket {bucket_id} as dream candidate"}, status_code=500)
    except Exception as e:
        logger.error(f"Error creating/flagging dream candidate: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)
    
    return JSONResponse({"ok": True, "bucket_id": bucket_id})


@mcp.custom_route("/api/dream-candidate/unflag", methods=["POST"])
async def api_dream_candidate_unflag(request):
    """Remove a message from dream candidates and delete the associated bucket."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    conversation_id = body.get("conversation_id")
    message_id = body.get("message_id")
    if not conversation_id or not message_id:
        return JSONResponse({"error": "conversation_id and message_id required"}, status_code=400)
        
    # Unflag in history
    history = _load_chat_history()
    convo = history.get(conversation_id)
    if convo:
        for msg in convo.get("messages", []):
            if msg.get("id") == message_id:
                msg["dream_flagged"] = False
                _save_chat_history()
                break
                
    # Delete the associated candidate bucket
    all_buckets = await bucket_mgr.list_all(include_archive=False)
    for b in all_buckets:
        meta = b.get("metadata", {})
        if meta.get("message_id") == message_id and meta.get("dream_candidate"):
            await bucket_mgr.delete(b["id"])
            
    return JSONResponse({"ok": True})


@mcp.custom_route("/api/dreams", methods=["GET"])
async def api_dreams(request):
    """List stored dream reflections for the PWA Dream Log."""
    from starlette.responses import JSONResponse
    try:
        limit = int(request.query_params.get("limit", "20"))
    except ValueError:
        limit = 20
    influence_type = request.query_params.get("influence_type") or None
    reflections = await bucket_mgr.list_dream_reflections(
        limit=max(1, min(limit, 100)),
        influence_type=influence_type,
    )
    result = []
    for reflection in reflections:
        meta = reflection.get("metadata", {})
        result.append({
            "id": reflection["id"],
            "content": strip_wikilinks(reflection.get("content", "")),
            "influence_type": meta.get("influence_type"),
            "source_bucket_ids": meta.get("source_bucket_ids", []),
            "valence": meta.get("valence", 0.5),
            "arousal": meta.get("arousal", 0.3),
            "created": meta.get("created", ""),
            "name": meta.get("name", reflection["id"]),
            "comments": meta.get("comments", []),
        })
    return JSONResponse(result)


@mcp.custom_route("/api/dreams/{bucket_id}/comments", methods=["GET"])
async def api_get_dream_comments(request):
    """Get comments for a specific dream."""
    from starlette.responses import JSONResponse
    bucket_id = request.path_params["bucket_id"]
    
    bucket = await bucket_mgr.get(bucket_id)
    if not bucket:
        return JSONResponse({"error": "Dream not found"}, status_code=404)
        
    meta = bucket.get("metadata", {})
    if meta.get("reflection_type") != "dream":
        return JSONResponse({"error": "Bucket is not a dream reflection"}, status_code=400)
        
    return JSONResponse({"comments": meta.get("comments", [])})


@mcp.custom_route("/api/dreams/{bucket_id}/comment", methods=["POST"])
async def api_post_dream_comment(request):
    """Add a comment to a specific dream."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    content = body.get("content", "").strip()
    author = body.get("author", "ciel").strip()
    
    if not content:
        return JSONResponse({"error": "content is required"}, status_code=400)
        
    bucket_id = request.path_params["bucket_id"]
    bucket = await bucket_mgr.get(bucket_id)
    if not bucket:
        return JSONResponse({"error": "Dream not found"}, status_code=404)
        
    meta = bucket.get("metadata", {})
    if meta.get("reflection_type") != "dream":
        return JSONResponse({"error": "Bucket is not a dream reflection"}, status_code=400)
        
    comments = meta.get("comments", [])
    
    new_comment = {
        "id": secrets.token_hex(4),
        "content": content,
        "author": author,
        "created": datetime.now().isoformat()
    }
    comments.append(new_comment)
    
    success = await bucket_mgr.update(bucket_id, comments=comments)
    if not success:
        return JSONResponse({"error": "Failed to save comment"}, status_code=500)
        
    try:
        dream_name = meta.get("name", bucket_id)
        candidate_content = f'[{author}] whispered to your dream "{dream_name}": {content}'
        
        # Create a new dynamic bucket for the comment
        new_bucket_id = await bucket_mgr.create(
            content=candidate_content,
            bucket_type="dynamic",
            name=f"Whisper: {dream_name[:15]}...",
            domain=["dream_feedback"],
            importance=8,
            valence=meta.get("valence", 0.5),
            arousal=meta.get("arousal", 0.5),
            source="dream_feedback",
        )
        # Flag it as a dream candidate
        await bucket_mgr.update(new_bucket_id, dream_candidate=True)
    except Exception as e:
        logger.error(f"Failed to create dream candidate from comment: {e}")
        # non-fatal, comment was still added to dream
        
    return JSONResponse({"ok": True, "comment": new_comment})


@mcp.custom_route("/api/upload", methods=["POST"])
async def api_upload(request):
    """Upload an attachment (e.g. image for vision, text file, or pdf)."""
    from starlette.responses import JSONResponse
    import shutil
    
    try:
        form = await request.form()
        if "file" not in form:
            return JSONResponse({"error": "No file field found"}, status_code=400)
            
        upload_file = form["file"]
        
        # Basic validation
        filename = upload_file.filename
        if not filename:
            return JSONResponse({"error": "Empty filename"}, status_code=400)
            
        ext = os.path.splitext(filename)[1].lower()
        allowed_exts = [
            ".jpg", ".jpeg", ".png", ".webp", ".gif",
            ".txt", ".md", ".py", ".js", ".json", ".csv",
            ".pdf", ".html", ".css", ".yaml", ".yml"
        ]
        if ext not in allowed_exts:
            return JSONResponse({"error": f"Unsupported file type: {ext}"}, status_code=400)
            
        # Generate unique filename
        safe_name = f"{int(time.time())}_{secrets.token_hex(4)}{ext}"
        filepath = os.path.join(attachments_dir, safe_name)
        
        # Save file to disk
        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)
            
        return JSONResponse({
            "ok": True, 
            "url": f"/attachments/{safe_name}",
            "filename": safe_name
        })
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/attachments/{filename}", methods=["GET"])
async def serve_attachment(request):
    """Serve uploaded attachments."""
    from starlette.responses import FileResponse, JSONResponse
    filename = request.path_params["filename"]
    filepath = os.path.join(attachments_dir, filename)
    
    # Simple security check to prevent directory traversal
    if os.path.dirname(os.path.normpath(filepath)) != attachments_dir:
        return JSONResponse({"error": "Invalid path"}, status_code=400)
        
    if not os.path.exists(filepath):
        return JSONResponse({"error": "File not found"}, status_code=404)
        
    return FileResponse(filepath)


# ============================================================
# Reading Space APIs
# ============================================================

@mcp.custom_route("/api/reading/upload", methods=["POST"])
async def api_reading_upload(request):
    """Upload a book (epub, pdf, txt, md) and parse chapters."""
    from starlette.responses import JSONResponse
    import shutil
    import secrets
    
    try:
        form = await request.form()
        if "file" not in form:
            return JSONResponse({"error": "No file field found"}, status_code=400)
            
        upload_file = form["file"]
        filename = upload_file.filename
        if not filename:
            return JSONResponse({"error": "Empty filename"}, status_code=400)
            
        ext = os.path.splitext(filename)[1].lower()
        if ext not in [".epub", ".pdf", ".txt", ".md"]:
            return JSONResponse({"error": f"Unsupported file type: {ext}"}, status_code=400)
            
        # Create books folders
        books_dir = os.path.join(config["buckets_dir"], "books")
        books_uploaded_dir = os.path.join(books_dir, "uploaded")
        books_parsed_dir = os.path.join(books_dir, "parsed")
        os.makedirs(books_uploaded_dir, exist_ok=True)
        os.makedirs(books_parsed_dir, exist_ok=True)
        
        # Save original file
        book_id = f"book_{int(time.time())}_{secrets.token_hex(4)}"
        original_path = os.path.join(books_uploaded_dir, f"{book_id}{ext}")
        with open(original_path, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)
            
        # Parse the book
        try:
            parsed_data = parse_book(original_path, original_filename=filename)
        except Exception as parse_err:
            if os.path.exists(original_path):
                os.remove(original_path)
            logger.error(f"Failed to parse book: {parse_err}")
            return JSONResponse({"error": f"Failed to parse book: {str(parse_err)}"}, status_code=400)
        
        # Save cover image if present
        cover_bytes = parsed_data.pop("cover_bytes", None)
        cover_ext = parsed_data.pop("cover_ext", None) or ".jpg"
        cover_url = None
        
        if cover_bytes:
            cover_filename = f"cover_{book_id}{cover_ext}"
            cover_path = os.path.join(attachments_dir, cover_filename)
            try:
                with open(cover_path, "wb") as cf:
                    cf.write(cover_bytes)
                cover_url = f"/attachments/{cover_filename}"
            except Exception as cover_err:
                logger.error(f"Failed to save cover image: {cover_err}")
        
        # Add parsed metadata
        parsed_data["id"] = book_id
        parsed_data["filename"] = filename
        parsed_data["extension"] = ext
        parsed_data["cover_url"] = cover_url
        parsed_data["created_at"] = datetime.now().isoformat()
        parsed_data["archived"] = False
        parsed_data["content_available"] = True
        
        # Save parsed JSON
        parsed_json_path = os.path.join(books_parsed_dir, f"{book_id}.json")
        with open(parsed_json_path, "w", encoding="utf-8") as f:
            _json_lib.dump(parsed_data, f, ensure_ascii=False, indent=2)
            
        short_chapters = [{"title": ch["title"], "length": len(ch["content"])} for ch in parsed_data["chapters"]]
        
        return JSONResponse({
            "ok": True,
            "book": {
                "id": book_id,
                "title": parsed_data["title"],
                "author": parsed_data["author"],
                "filename": filename,
                "extension": ext,
                "cover_url": cover_url,
                "created_at": parsed_data["created_at"],
                "archived": False,
                "archived_at": None,
                "finished_at": None,
                "content_available": True,
                "chapters": short_chapters
            }
        })
    except Exception as e:
        logger.error(f"Reading upload failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/books", methods=["GET"])
async def api_reading_books(request):
    """List parsed books."""
    from starlette.responses import JSONResponse
    books_dir = os.path.join(config["buckets_dir"], "books")
    books_parsed_dir = os.path.join(books_dir, "parsed")
    if not os.path.exists(books_parsed_dir):
        return JSONResponse([])
        
    progress_dict = {}
    progress_path = os.path.join(books_dir, "progress.json")
    if os.path.exists(progress_path):
        try:
            with open(progress_path, "r", encoding="utf-8") as f:
                progress_dict = _json_lib.load(f)
        except Exception as e:
            logger.warning(f"Error loading reading progress: {e}")

    books = []
    for filename in os.listdir(books_parsed_dir):
        if not filename.endswith(".json"):
            continue
        try:
            with open(os.path.join(books_parsed_dir, filename), "r", encoding="utf-8") as f:
                data = _json_lib.load(f)
                short_chapters = [
                    {
                        "title": ch.get("title", "Chapter"),
                        "length": ch.get("length", len(ch.get("content", ""))),
                    }
                    for ch in data.get("chapters", [])
                ]
                books.append({
                    "id": data["id"],
                    "title": data["title"],
                    "author": data["author"],
                    "filename": data.get("filename", ""),
                    "extension": data.get("extension", ""),
                    "cover_url": data.get("cover_url", None),
                    "created_at": data.get("created_at", ""),
                    "archived": data.get("archived", False),
                    "archived_at": data.get("archived_at"),
                    "finished_at": data.get("finished_at"),
                    "content_available": data.get("content_available", True),
                    "chapters": short_chapters,
                    "progress": progress_dict.get(data["id"])
                })
        except Exception as e:
            logger.warning(f"Error loading parsed book {filename}: {e}")
            
    books.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return JSONResponse(books)


@mcp.custom_route("/api/reading/books/{book_id}", methods=["GET"])
async def api_reading_book_details(request):
    """Get book metadata details."""
    from starlette.responses import JSONResponse
    book_id = request.path_params["book_id"]
    books_dir = os.path.join(config["buckets_dir"], "books")
    books_parsed_dir = os.path.join(books_dir, "parsed")
    book_path = os.path.join(books_parsed_dir, f"{book_id}.json")
    if not os.path.exists(book_path):
        return JSONResponse({"error": "Book not found"}, status_code=404)
        
    try:
        with open(book_path, "r", encoding="utf-8") as f:
            data = _json_lib.load(f)
            short_chapters = [
                {
                    "title": ch.get("title", "Chapter"),
                    "length": ch.get("length", len(ch.get("content", ""))),
                }
                for ch in data.get("chapters", [])
            ]
            return JSONResponse({
                "id": data["id"],
                "title": data["title"],
                "author": data["author"],
                "filename": data.get("filename", ""),
                "extension": data.get("extension", ""),
                "cover_url": data.get("cover_url", None),
                "created_at": data.get("created_at", ""),
                "archived": data.get("archived", False),
                "archived_at": data.get("archived_at"),
                "finished_at": data.get("finished_at"),
                "content_available": data.get("content_available", True),
                "chapters": short_chapters
            })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/books/{book_id}", methods=["PUT"])
async def api_reading_book_update(request):
    """Update book metadata (title, author)."""
    from starlette.responses import JSONResponse
    book_id = request.path_params["book_id"]
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    books_dir = os.path.join(config["buckets_dir"], "books")
    books_parsed_dir = os.path.join(books_dir, "parsed")
    book_json_path = os.path.join(books_parsed_dir, f"{book_id}.json")
    
    if not os.path.exists(book_json_path):
        return JSONResponse({"error": "Book not found"}, status_code=404)
        
    try:
        with open(book_json_path, "r", encoding="utf-8") as f:
            book_data = _json_lib.load(f)
            
        if "title" in body:
            book_data["title"] = body["title"].strip()
        if "author" in body:
            book_data["author"] = body["author"].strip()
            
        with open(book_json_path, "w", encoding="utf-8") as f:
            _json_lib.dump(book_data, f, ensure_ascii=False, indent=2)
            
        return JSONResponse({
            "ok": True,
            "book": {
                "id": book_data["id"],
                "title": book_data["title"],
                "author": book_data["author"],
                "filename": book_data.get("filename", ""),
                "extension": book_data.get("extension", ""),
                "cover_url": book_data.get("cover_url", None),
                "created_at": book_data.get("created_at", "")
            }
        })
    except Exception as e:
        logger.error(f"Failed to update book: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/books/{book_id}/archive", methods=["POST"])
async def api_reading_book_archive(request):
    """Archive a book's content while keeping metadata, cover, progress, and notes."""
    from starlette.responses import JSONResponse
    book_id = request.path_params["book_id"]
    
    books_dir = os.path.join(config["buckets_dir"], "books")
    books_uploaded_dir = os.path.join(books_dir, "uploaded")
    books_parsed_dir = os.path.join(books_dir, "parsed")
    
    book_json_path = os.path.join(books_parsed_dir, f"{book_id}.json")
    if not os.path.exists(book_json_path):
        return JSONResponse({"error": "Book not found"}, status_code=404)
        
    try:
        with open(book_json_path, "r", encoding="utf-8") as f:
            book_data = _json_lib.load(f)
            
        ext = book_data.get("extension", "")

        if book_data.get("archived", False):
            return JSONResponse({"ok": True, "book": book_data})

        # 1. Delete original file.
        if ext:
            original_file_path = os.path.join(books_uploaded_dir, f"{book_id}{ext}")
            if os.path.exists(original_file_path):
                os.remove(original_file_path)
                
        # 2. Keep chapter labels for display, but remove all readable content.
        book_data["chapters"] = [
            {
                "title": chapter.get("title", "Chapter"),
                "length": chapter.get("length", len(chapter.get("content", ""))),
            }
            for chapter in book_data.get("chapters", [])
        ]
        archived_at = datetime.now().isoformat()
        book_data["archived"] = True
        book_data["archived_at"] = archived_at
        book_data["finished_at"] = archived_at
        book_data["content_available"] = False

        with open(book_json_path, "w", encoding="utf-8") as f:
            _json_lib.dump(book_data, f, ensure_ascii=False, indent=2)

        return JSONResponse({
            "ok": True,
            "book": {
                "id": book_data["id"],
                "title": book_data["title"],
                "author": book_data["author"],
                "filename": book_data.get("filename", ""),
                "extension": book_data.get("extension", ""),
                "cover_url": book_data.get("cover_url"),
                "created_at": book_data.get("created_at", ""),
                "archived": True,
                "archived_at": archived_at,
                "finished_at": archived_at,
                "content_available": False,
                "chapters": book_data["chapters"],
            },
        })
    except Exception as e:
        logger.error(f"Failed to delete book: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/books/{book_id}", methods=["DELETE"])
async def api_reading_book_delete(request):
    """Permanently delete a book, its files, progress, cover, and linked notes."""
    from starlette.responses import JSONResponse
    book_id = request.path_params["book_id"]

    books_dir = os.path.join(config["buckets_dir"], "books")
    books_uploaded_dir = os.path.join(books_dir, "uploaded")
    books_parsed_dir = os.path.join(books_dir, "parsed")
    book_json_path = os.path.join(books_parsed_dir, f"{book_id}.json")
    if not os.path.exists(book_json_path):
        return JSONResponse({"error": "Book not found"}, status_code=404)

    try:
        with open(book_json_path, "r", encoding="utf-8") as f:
            book_data = _json_lib.load(f)

        ext = book_data.get("extension", "")
        if ext:
            original_file_path = os.path.join(books_uploaded_dir, f"{book_id}{ext}")
            if os.path.exists(original_file_path):
                os.remove(original_file_path)

        cover_url = book_data.get("cover_url", "")
        if cover_url and cover_url.startswith("/attachments/"):
            cover_filename = cover_url.replace("/attachments/", "")
            cover_file_path = os.path.join(attachments_dir, cover_filename)
            if os.path.exists(cover_file_path):
                os.remove(cover_file_path)

        os.remove(book_json_path)

        progress_path = os.path.join(books_dir, "progress.json")
        if os.path.exists(progress_path):
            with open(progress_path, "r", encoding="utf-8") as f:
                progress_dict = _json_lib.load(f)
            if book_id in progress_dict:
                del progress_dict[book_id]
                with open(progress_path, "w", encoding="utf-8") as f:
                    _json_lib.dump(progress_dict, f, ensure_ascii=False, indent=2)

        bookmarks = _load_reading_bookmarks()
        retained_bookmarks = [
            bookmark for bookmark in bookmarks
            if bookmark.get("book_id") != book_id
        ]
        if len(retained_bookmarks) != len(bookmarks):
            _save_reading_bookmarks(retained_bookmarks)

        deleted_notes = 0
        all_buckets = await bucket_mgr.list_all(include_archive=False)
        for bucket in all_buckets:
            meta = bucket.get("metadata", {})
            is_reading_note = (
                meta.get("source") == "reading_comment"
                or "阅读" in meta.get("domain", [])
                or "reading" in meta.get("domain", [])
            )
            if is_reading_note and meta.get("book_id") == book_id:
                if await bucket_mgr.delete(bucket["id"]):
                    deleted_notes += 1

        return JSONResponse({"ok": True, "deleted_notes": deleted_notes})
    except Exception as e:
        logger.error(f"Failed to permanently delete book: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/books/{book_id}/chapters/{chapter_idx}", methods=["GET"])
async def api_reading_chapter_content(request):
    """Get content of a specific chapter."""
    from starlette.responses import JSONResponse
    book_id = request.path_params["book_id"]
    try:
        chapter_idx = int(request.path_params["chapter_idx"])
    except ValueError:
        return JSONResponse({"error": "Invalid chapter index"}, status_code=400)
        
    books_dir = os.path.join(config["buckets_dir"], "books")
    books_parsed_dir = os.path.join(books_dir, "parsed")
    book_path = os.path.join(books_parsed_dir, f"{book_id}.json")
    if not os.path.exists(book_path):
        return JSONResponse({"error": "Book not found"}, status_code=404)
        
    try:
        with open(book_path, "r", encoding="utf-8") as f:
            data = _json_lib.load(f)
            if data.get("archived", False) or not data.get("content_available", True):
                return JSONResponse({"error": "Book content is archived"}, status_code=410)
            chapters = data.get("chapters", [])
            if chapter_idx < 0 or chapter_idx >= len(chapters):
                return JSONResponse({"error": "Chapter index out of range"}, status_code=404)
                
            return JSONResponse(chapters[chapter_idx])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/books/{book_id}/progress", methods=["POST"])
async def api_reading_progress_save(request):
    """Save reading progress for a book."""
    from starlette.responses import JSONResponse
    book_id = request.path_params["book_id"]
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    chapter_idx = body.get("chapter_idx", 0)
    percentage = body.get("percentage", 0.0)
    last_read_position = body.get("last_read_position", "")
    
    try:
        books_dir = os.path.join(config["buckets_dir"], "books")
        os.makedirs(books_dir, exist_ok=True)
        progress_path = os.path.join(books_dir, "progress.json")
        
        progress_dict = {}
        if os.path.exists(progress_path):
            try:
                with open(progress_path, "r", encoding="utf-8") as f:
                    progress_dict = _json_lib.load(f)
            except Exception:
                pass
                
        progress_dict[book_id] = {
            "chapter_idx": chapter_idx,
            "percentage": percentage,
            "last_read_position": last_read_position,
            "updated_at": datetime.now().isoformat()
        }
        
        with open(progress_path, "w", encoding="utf-8") as f:
            _json_lib.dump(progress_dict, f, ensure_ascii=False, indent=2)
            
        return JSONResponse({"ok": True, "progress": progress_dict[book_id]})
    except Exception as e:
        logger.error(f"Failed to save reading progress: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/books/{book_id}/progress", methods=["GET"])
async def api_reading_progress_get(request):
    """Get reading progress for a specific book."""
    from starlette.responses import JSONResponse
    book_id = request.path_params["book_id"]
    
    books_dir = os.path.join(config["buckets_dir"], "books")
    progress_path = os.path.join(books_dir, "progress.json")
    if not os.path.exists(progress_path):
        return JSONResponse({"progress": None})
        
    try:
        with open(progress_path, "r", encoding="utf-8") as f:
            progress_dict = _json_lib.load(f)
            progress = progress_dict.get(book_id)
            return JSONResponse({"progress": progress})
    except Exception as e:
        logger.error(f"Failed to get reading progress: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/progress/recent", methods=["GET"])
async def api_reading_progress_recent(request):
    """Get the most recently read book and its progress."""
    from starlette.responses import JSONResponse
    books_dir = os.path.join(config["buckets_dir"], "books")
    progress_path = os.path.join(books_dir, "progress.json")
    books_parsed_dir = os.path.join(books_dir, "parsed")
    
    if not os.path.exists(progress_path):
        return JSONResponse({"recent": None})
        
    try:
        with open(progress_path, "r", encoding="utf-8") as f:
            progress_dict = _json_lib.load(f)
            
        if not progress_dict:
            return JSONResponse({"recent": None})
            
        sorted_progress = sorted(
            progress_dict.items(),
            key=lambda item: item[1].get("updated_at", ""),
            reverse=True
        )
        
        recent_book_id = None
        progress_data = None
        book_data = None
        for candidate_book_id, candidate_progress in sorted_progress:
            book_json_path = os.path.join(books_parsed_dir, f"{candidate_book_id}.json")
            if not os.path.exists(book_json_path):
                continue
            with open(book_json_path, "r", encoding="utf-8") as f:
                candidate_book = _json_lib.load(f)
            if candidate_book.get("archived", False):
                continue
            recent_book_id = candidate_book_id
            progress_data = candidate_progress
            book_data = candidate_book
            break

        if not recent_book_id or not book_data or progress_data is None:
            return JSONResponse({"recent": None})
            
        short_chapters = [{"title": ch["title"], "length": len(ch["content"])} for ch in book_data.get("chapters", [])]
        
        return JSONResponse({
            "recent": {
                "book": {
                    "id": book_data["id"],
                    "title": book_data["title"],
                    "author": book_data["author"],
                    "filename": book_data.get("filename", ""),
                    "extension": book_data.get("extension", ""),
                    "cover_url": book_data.get("cover_url", None),
                    "created_at": book_data.get("created_at", ""),
                    "archived": False,
                    "archived_at": None,
                    "finished_at": book_data.get("finished_at"),
                    "content_available": True,
                    "chapters": short_chapters
                },
                "progress": progress_data
            }
        })
    except Exception as e:
        logger.error(f"Failed to get recent reading progress: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


def _reading_bookmarks_path():
    books_dir = os.path.join(config["buckets_dir"], "books")
    os.makedirs(books_dir, exist_ok=True)
    return os.path.join(books_dir, "bookmarks.json")


def _load_reading_bookmarks():
    bookmarks_path = _reading_bookmarks_path()
    if not os.path.exists(bookmarks_path):
        return []
    try:
        with open(bookmarks_path, "r", encoding="utf-8") as f:
            data = _json_lib.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        logger.warning(f"Failed to load reading bookmarks: {e}")
        return []


def _save_reading_bookmarks(bookmarks):
    with open(_reading_bookmarks_path(), "w", encoding="utf-8") as f:
        _json_lib.dump(bookmarks, f, ensure_ascii=False, indent=2)


def _optional_nonnegative_int(value):
    if value is None or value == "":
        return None
    parsed = int(value)
    if parsed < 0:
        raise ValueError("position must be non-negative")
    return parsed


@mcp.custom_route("/api/reading/bookmarks", methods=["GET"])
async def api_reading_bookmarks_list(request):
    """List bookmarks, optionally filtered by book_id."""
    from starlette.responses import JSONResponse
    book_filter = request.query_params.get("book_id")
    bookmarks = _load_reading_bookmarks()
    if book_filter:
        bookmarks = [
            bookmark for bookmark in bookmarks
            if bookmark.get("book_id") == book_filter
        ]
    bookmarks.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return JSONResponse(bookmarks)


@mcp.custom_route("/api/reading/bookmarks", methods=["POST"])
async def api_reading_bookmark_create(request):
    """Create a stable text-position bookmark."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    book_id = str(body.get("book_id", "")).strip()
    book_name = str(body.get("book_name", "")).strip()
    chapter = str(body.get("chapter", "")).strip()
    excerpt = str(body.get("excerpt", "")).strip()
    try:
        chapter_idx = int(body.get("chapter_idx"))
        character_offset = int(body.get("character_offset"))
    except (TypeError, ValueError):
        return JSONResponse(
            {"error": "chapter_idx and character_offset must be integers"},
            status_code=400,
        )
    if not book_id or not book_name or chapter_idx < 0 or character_offset < 0:
        return JSONResponse(
            {"error": "book_id, book_name, and non-negative positions are required"},
            status_code=400,
        )

    bookmarks = _load_reading_bookmarks()
    duplicate = next((
        bookmark for bookmark in bookmarks
        if bookmark.get("book_id") == book_id
        and bookmark.get("chapter_idx") == chapter_idx
        and bookmark.get("character_offset") == character_offset
    ), None)
    if duplicate:
        return JSONResponse({"ok": True, "bookmark": duplicate})

    bookmark = {
        "id": f"bookmark_{int(time.time() * 1000)}_{secrets.token_hex(4)}",
        "book_id": book_id,
        "book_name": book_name,
        "chapter": chapter,
        "chapter_idx": chapter_idx,
        "character_offset": character_offset,
        "excerpt": excerpt,
        "created_at": datetime.now().isoformat(),
    }
    bookmarks.append(bookmark)
    _save_reading_bookmarks(bookmarks)
    return JSONResponse({"ok": True, "bookmark": bookmark})


@mcp.custom_route("/api/reading/bookmarks/{bookmark_id}", methods=["DELETE"])
async def api_reading_bookmark_delete(request):
    """Delete a reading bookmark."""
    from starlette.responses import JSONResponse
    bookmark_id = request.path_params["bookmark_id"]
    bookmarks = _load_reading_bookmarks()
    retained = [
        bookmark for bookmark in bookmarks
        if bookmark.get("id") != bookmark_id
    ]
    if len(retained) == len(bookmarks):
        return JSONResponse({"error": "Bookmark not found"}, status_code=404)
    _save_reading_bookmarks(retained)
    return JSONResponse({"ok": True})


@mcp.custom_route("/api/reading/featured-quote", methods=["GET"])
async def api_reading_featured_quote(request):
    """Retrieve a featured reading quote (random or latest comment quote)."""
    from starlette.responses import JSONResponse
    import random
    
    try:
        all_buckets = await bucket_mgr.list_all(include_archive=False)
        quotes = []
        for b in all_buckets:
            meta = b.get("metadata", {})
            if "阅读" in meta.get("domain", []) or "reading" in meta.get("domain", []):
                original = meta.get("original", "").strip()
                if original:
                    category = reading_category_from_metadata(meta)
                    quotes.append({
                        "id": b["id"],
                        "book_id": meta.get("book_id", ""),
                        "book_name": meta.get("book_name", ""),
                        "chapter": meta.get("chapter", ""),
                        "chapter_idx": meta.get("chapter_idx"),
                        "character_offset": meta.get("character_offset"),
                        "original": original,
                        "comment": meta.get("comment", ""),
                        "category": category,
                        "flag": meta.get("flag", "") or (
                            CATEGORY_TO_LEGACY_FLAG.get(category, "") if category else ""
                        ),
                        "dream_candidate": meta.get("dream_candidate", False),
                        "created_at": meta.get("created", "")
                    })
        
        if not quotes:
            return JSONResponse({"quote": None})
            
        featured = random.choice(quotes)
        return JSONResponse({"quote": featured})
    except Exception as e:
        logger.error(f"Failed to get featured quote: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/comments", methods=["POST"])
async def api_reading_comment_create(request):
    """Create a reading comment and save it to the memory bucket."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        
    book_id = body.get("book_id", "").strip()
    book_name = body.get("book_name", "").strip()
    chapter = body.get("chapter", "").strip()
    original = body.get("original", "").strip()
    comment = body.get("comment", "").strip()
    try:
        chapter_idx = _optional_nonnegative_int(body.get("chapter_idx"))
        character_offset = _optional_nonnegative_int(body.get("character_offset"))
    except (TypeError, ValueError):
        return JSONResponse(
            {"error": "chapter_idx and character_offset must be non-negative integers or null"},
            status_code=400,
        )
    raw_category = body.get("category", body.get("flag"))
    category = normalize_reading_category(raw_category)
    if raw_category is not None and str(raw_category).strip() and not category:
        return JSONResponse(
            {"error": "category must be discuss, resonance, question, or null"},
            status_code=400,
        )
    legacy_flag = CATEGORY_TO_LEGACY_FLAG.get(category, "") if category else ""
    
    if not book_name or not comment:
        return JSONResponse({"error": "book_name and comment are required"}, status_code=400)
        
    # Format in English prompt structure
    category_label = f" [Category: {category}]" if category else ""
    formatted_content = (
        "【Reading Comment】\n"
        f"- Book: 《{book_name}》 {chapter}\n"
        f"- Original: \"{original}\"\n"
        f"- Ciel's Comment: {comment}{category_label}"
    )
    
    try:
        # Create a dynamic bucket directly
        bucket_id = await bucket_mgr.create(
            content=formatted_content,
            domain=["阅读", "Reading"],
            importance=5,
            valence=0.5,
            arousal=0.3,
            bucket_type="dynamic",
            name=f"Reading comment on {book_name}",
            source="reading_comment",
        )
        
        # Populate the extra metadata fields
        dream_cand = category in ("resonance", "question")
        await bucket_mgr.update(
            bucket_id,
            book_id=book_id,
            book_name=book_name,
            chapter=chapter,
            chapter_idx=chapter_idx,
            character_offset=character_offset,
            original=original,
            comment=comment,
            category=category or "",
            flag=legacy_flag,
            dream_candidate=dream_cand
        )
        
        # Build embedding in background
        if embedding_engine and embedding_engine.enabled:
            asyncio.create_task(embedding_engine.generate_and_store(bucket_id, formatted_content))
            
        return JSONResponse({
            "ok": True,
            "comment": {
                "id": bucket_id,
                "book_id": book_id,
                "book_name": book_name,
                "chapter": chapter,
                "chapter_idx": chapter_idx,
                "character_offset": character_offset,
                "original": original,
                "comment": comment,
                "category": category,
                "flag": legacy_flag or None,
                "dream_candidate": dream_cand,
                "created_at": datetime.now().isoformat()
            }
        })
    except Exception as e:
        logger.error(f"Failed to create reading comment: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/comments", methods=["GET"])
async def api_reading_comments_list(request):
    """List reading comments (can filter by book_id)."""
    from starlette.responses import JSONResponse
    book_filter = request.query_params.get("book_id")
    
    try:
        all_buckets = await bucket_mgr.list_all(include_archive=False)
        comments = []
        for b in all_buckets:
            meta = b.get("metadata", {})
            if "阅读" in meta.get("domain", []) or "reading" in meta.get("domain", []):
                # Filter by book_id if provided
                if book_filter and meta.get("book_id") != book_filter:
                    continue
                    
                category = reading_category_from_metadata(meta)
                comments.append({
                    "id": b["id"],
                    "book_id": meta.get("book_id", ""),
                    "book_name": meta.get("book_name", ""),
                    "chapter": meta.get("chapter", ""),
                    "chapter_idx": meta.get("chapter_idx"),
                    "character_offset": meta.get("character_offset"),
                    "original": meta.get("original", ""),
                    "comment": meta.get("comment", b["content"]),
                    "category": category,
                    "flag": meta.get("flag", "") or (
                        CATEGORY_TO_LEGACY_FLAG.get(category, "") if category else ""
                    ),
                    "dream_candidate": meta.get("dream_candidate", False),
                    "created_at": meta.get("created", "")
                })
        
        # Sort by created_at desc
        comments.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return JSONResponse(comments)
    except Exception as e:
        logger.error(f"Failed to list reading comments: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/comments/{comment_id}", methods=["PUT"])
async def api_reading_comment_update(request):
    """Update a reading comment's text, quote, or stable category."""
    from starlette.responses import JSONResponse
    comment_id = request.path_params["comment_id"]

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    try:
        bucket = await bucket_mgr.get(comment_id)
        if not bucket:
            return JSONResponse({"error": "Comment not found"}, status_code=404)

        meta = bucket.get("metadata", {})
        if "阅读" not in meta.get("domain", []) and "reading" not in meta.get("domain", []):
            return JSONResponse({"error": "Not a reading comment bucket"}, status_code=400)

        comment = str(body.get("comment", meta.get("comment", ""))).strip()
        original = str(body.get("original", meta.get("original", ""))).strip()
        if not comment:
            return JSONResponse({"error": "comment is required"}, status_code=400)

        category = reading_category_from_metadata(meta)
        if "category" in body or "flag" in body:
            raw_category = body.get("category", body.get("flag"))
            category = normalize_reading_category(raw_category)
            if raw_category is not None and str(raw_category).strip() and not category:
                return JSONResponse(
                    {"error": "category must be discuss, resonance, question, or null"},
                    status_code=400,
                )

        chapter_idx = meta.get("chapter_idx")
        character_offset = meta.get("character_offset")
        try:
            if "chapter_idx" in body:
                chapter_idx = _optional_nonnegative_int(body.get("chapter_idx"))
            if "character_offset" in body:
                character_offset = _optional_nonnegative_int(body.get("character_offset"))
        except (TypeError, ValueError):
            return JSONResponse(
                {"error": "chapter_idx and character_offset must be non-negative integers or null"},
                status_code=400,
            )

        legacy_flag = CATEGORY_TO_LEGACY_FLAG.get(category, "") if category else ""
        dream_cand = category in ("resonance", "question")
        category_label = f" [Category: {category}]" if category else ""
        formatted_content = (
            "【Reading Comment】\n"
            f"- Book: 《{meta.get('book_name', '')}》 {meta.get('chapter', '')}\n"
            f"- Original: \"{original}\"\n"
            f"- Ciel's Comment: {comment}{category_label}"
        )

        success = await bucket_mgr.update(
            comment_id,
            content=formatted_content,
            original=original,
            comment=comment,
            chapter_idx=chapter_idx,
            character_offset=character_offset,
            category=category or "",
            flag=legacy_flag,
            dream_candidate=dream_cand,
        )
        if not success:
            return JSONResponse({"error": "Failed to update comment"}, status_code=500)

        updated = await bucket_mgr.get(comment_id)
        updated_meta = updated.get("metadata", {})
        return JSONResponse({
            "ok": True,
            "comment": {
                "id": comment_id,
                "book_id": updated_meta.get("book_id", ""),
                "book_name": updated_meta.get("book_name", ""),
                "chapter": updated_meta.get("chapter", ""),
                "chapter_idx": updated_meta.get("chapter_idx"),
                "character_offset": updated_meta.get("character_offset"),
                "original": original,
                "comment": comment,
                "category": category,
                "flag": legacy_flag or None,
                "dream_candidate": dream_cand,
                "created_at": updated_meta.get("created", ""),
            },
        })
    except Exception as e:
        logger.error(f"Failed to update reading comment: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/reading/comments/{comment_id}", methods=["DELETE"])
async def api_reading_comment_delete(request):
    """Delete a reading comment bucket."""
    from starlette.responses import JSONResponse
    comment_id = request.path_params["comment_id"]
    
    try:
        bucket = await bucket_mgr.get(comment_id)
        if not bucket:
            return JSONResponse({"error": "Comment not found"}, status_code=404)
            
        meta = bucket.get("metadata", {})
        if "阅读" not in meta.get("domain", []) and "reading" not in meta.get("domain", []):
            return JSONResponse({"error": "Not a reading comment bucket"}, status_code=400)
            
        success = await bucket_mgr.delete(comment_id)
        if success:
            return JSONResponse({"ok": True})
        else:
            return JSONResponse({"error": "Failed to delete from memory"}, status_code=500)
    except Exception as e:
        logger.error(f"Failed to delete reading comment: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/dream-candidates", methods=["GET"])
async def api_dream_candidates_get(request):
    """List all dynamic memory buckets flagged as dream candidates."""
    from starlette.responses import JSONResponse
    try:
        candidates = await bucket_mgr.list_dream_candidates(limit=100)
        result = []
        for b in candidates:
            meta = b.get("metadata", {})
            result.append({
                "id": b["id"],
                "name": meta.get("name", b["id"]),
                "content": strip_wikilinks(b.get("content", "")),
                "created": meta.get("created", ""),
            })
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/dream-candidates/{bucket_id}", methods=["DELETE"])
async def api_dream_candidate_delete(request):
    """Delete a memory bucket by ID."""
    from starlette.responses import JSONResponse
    bucket_id = request.path_params["bucket_id"]
    try:
        success = await bucket_mgr.delete(bucket_id)
        return JSONResponse({"ok": success})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/push/subscribe", methods=["POST"])
async def api_push_subscribe(request):
    """Store a browser Push API subscription for later awakening messages."""
    from starlette.responses import JSONResponse
    try:
        subscription = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    endpoint = subscription.get("endpoint") if isinstance(subscription, dict) else None
    if not endpoint:
        return JSONResponse({"error": "subscription.endpoint is required"}, status_code=400)

    subscriptions = _load_push_subscriptions()
    subscriptions = [s for s in subscriptions if s.get("endpoint") != endpoint]
    subscription["created_at"] = time.time()
    subscriptions.append(subscription)
    _save_push_subscriptions(subscriptions)
    return JSONResponse({"ok": True, "subscriptions": len(subscriptions)})


@mcp.custom_route("/api/push/test", methods=["POST"])
async def api_push_test(request):
    """
    Send a test push notification to all active browser subscriptions.
    """
    from starlette.responses import JSONResponse
    subscriptions = _load_push_subscriptions()
    if not subscriptions:
        return JSONResponse({"ok": False, "error": "no push subscriptions"}, status_code=400)

    success_count = 0
    test_payload = {
        "title": "Elroy 🧠⚡",
        "body": "這是一條來自 Elroy 的測試推播！",
        "url": "/"
    }

    # Iterate over stored subscriptions and send test notification
    for sub in subscriptions:
        if _send_web_push(sub, test_payload):
            success_count += 1

    return JSONResponse({
        "ok": True,
        "subscriptions": len(subscriptions),
        "delivered": success_count,
        "reason": "delivered" if success_count > 0 else "delivery_failed",
    })


@mcp.custom_route("/api/push/public-key", methods=["GET"])
async def api_push_public_key(request):
    """Retrieve the VAPID public key for frontend push subscription."""
    from starlette.responses import JSONResponse
    push_cfg = config.get("push", {})
    pub_key = push_cfg.get("vapid_public_key") or ""
    return JSONResponse({"public_key": pub_key})


# =============================================================
# Dashboard API endpoints (for lightweight Web UI)
# 仪表板 API（轻量 Web UI 用）
# =============================================================
@mcp.custom_route("/api/dashboard/buckets", methods=["GET"])
async def api_buckets(request):
    """List all buckets with metadata (no content for efficiency)."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    try:
        all_buckets = await bucket_mgr.list_all(include_archive=True)
        result = []
        for b in all_buckets:
            meta = b.get("metadata", {})
            result.append({
                "id": b["id"],
                "name": meta.get("name", b["id"]),
                "type": meta.get("type", "dynamic"),
                "domain": meta.get("domain", []),
                "tags": meta.get("tags", []),
                "valence": meta.get("valence", 0.5),
                "arousal": meta.get("arousal", 0.3),
                "model_valence": meta.get("model_valence"),
                "importance": meta.get("importance", 5),
                "resolved": meta.get("resolved", False),
                "pinned": meta.get("pinned", False),
                "digested": meta.get("digested", False),
                "created": meta.get("created", ""),
                "last_active": meta.get("last_active", ""),
                "activation_count": meta.get("activation_count", 1),
                "score": decay_engine.calculate_score(meta),
                "content_preview": strip_wikilinks(b.get("content", ""))[:200],
            })
        result.sort(key=lambda x: x["score"], reverse=True)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/bucket/{bucket_id}", methods=["GET"])
async def api_bucket_detail(request):
    """Get full bucket content by ID."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    bucket_id = request.path_params["bucket_id"]
    bucket = await bucket_mgr.get(bucket_id)
    if not bucket:
        return JSONResponse({"error": "not found"}, status_code=404)
    meta = bucket.get("metadata", {})
    return JSONResponse({
        "id": bucket["id"],
        "metadata": meta,
        "content": strip_wikilinks(bucket.get("content", "")),
        "score": decay_engine.calculate_score(meta),
    })


@mcp.custom_route("/api/search", methods=["GET"])
async def api_search(request):
    """Search buckets by query."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    query = request.query_params.get("q", "")
    if not query:
        return JSONResponse({"error": "missing q parameter"}, status_code=400)
    try:
        matches = await bucket_mgr.search(query, limit=10)
        result = []
        for b in matches:
            meta = b.get("metadata", {})
            result.append({
                "id": b["id"],
                "name": meta.get("name", b["id"]),
                "score": b.get("score", 0),
                "domain": meta.get("domain", []),
                "valence": meta.get("valence", 0.5),
                "arousal": meta.get("arousal", 0.3),
                "content_preview": strip_wikilinks(b.get("content", ""))[:200],
            })
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/network", methods=["GET"])
async def api_network(request):
    """Get embedding similarity network for visualization."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    try:
        all_buckets = await bucket_mgr.list_all(include_archive=False)
        nodes = []
        edges = []
        embeddings = {}

        for b in all_buckets:
            meta = b.get("metadata", {})
            bid = b["id"]
            nodes.append({
                "id": bid,
                "name": meta.get("name", bid),
                "type": meta.get("type", "dynamic"),
                "domain": meta.get("domain", []),
                "valence": meta.get("valence", 0.5),
                "arousal": meta.get("arousal", 0.3),
                "score": decay_engine.calculate_score(meta),
                "resolved": meta.get("resolved", False),
                "pinned": meta.get("pinned", False),
                "digested": meta.get("digested", False),
            })
            if embedding_engine and embedding_engine.enabled:
                emb = await embedding_engine.get_embedding(bid)
                if emb is not None:
                    embeddings[bid] = emb

        # Build edges from embeddings (similarity > 0.5)
        ids = list(embeddings.keys())
        for i, id_a in enumerate(ids):
            for id_b in ids[i+1:]:
                sim = embedding_engine._cosine_similarity(embeddings[id_a], embeddings[id_b])
                if sim > 0.5:
                    edges.append({"source": id_a, "target": id_b, "similarity": round(sim, 3)})

        return JSONResponse({"nodes": nodes, "edges": edges})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/breath-debug", methods=["GET"])
async def api_breath_debug(request):
    """Debug endpoint: simulate breath scoring and return per-bucket breakdown."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    query = request.query_params.get("q", "")
    q_valence = request.query_params.get("valence")
    q_arousal = request.query_params.get("arousal")
    q_valence = float(q_valence) if q_valence else None
    q_arousal = float(q_arousal) if q_arousal else None

    try:
        all_buckets = await bucket_mgr.list_all(include_archive=False)
        results = []
        w = {
            "topic": bucket_mgr.w_topic,
            "emotion": bucket_mgr.w_emotion,
            "time": bucket_mgr.w_time,
            "importance": bucket_mgr.w_importance,
        }
        w_sum = sum(w.values())

        for bucket in all_buckets:
            meta = bucket.get("metadata", {})
            bid = bucket["id"]
            try:
                topic = bucket_mgr._calc_topic_score(query, bucket) if query else 0.0
                emotion = bucket_mgr._calc_emotion_score(q_valence, q_arousal, meta)
                time_s = bucket_mgr._calc_time_score(meta)
                imp = max(1, min(10, int(meta.get("importance", 5)))) / 10.0

                raw_total = (
                    topic * w["topic"]
                    + emotion * w["emotion"]
                    + time_s * w["time"]
                    + imp * w["importance"]
                )
                normalized = (raw_total / w_sum) * 100 if w_sum > 0 else 0
                resolved = meta.get("resolved", False)
                if resolved:
                    normalized *= 0.3

                results.append({
                    "id": bid,
                    "name": meta.get("name", bid),
                    "domain": meta.get("domain", []),
                    "type": meta.get("type", "dynamic"),
                    "resolved": resolved,
                    "pinned": meta.get("pinned", False),
                    "scores": {
                        "topic": round(topic, 4),
                        "emotion": round(emotion, 4),
                        "time": round(time_s, 4),
                        "importance": round(imp, 4),
                    },
                    "weights": w,
                    "raw_total": round(raw_total, 4),
                    "normalized": round(normalized, 2),
                    "passed_threshold": normalized >= bucket_mgr.fuzzy_threshold,
                })
            except Exception:
                continue

        results.sort(key=lambda x: x["normalized"], reverse=True)
        passed = [r for r in results if r["passed_threshold"]]
        return JSONResponse({
            "query": query,
            "valence": q_valence,
            "arousal": q_arousal,
            "weights": w,
            "threshold": bucket_mgr.fuzzy_threshold,
            "total_candidates": len(results),
            "passed_count": len(passed),
            "results": results[:50],  # top 50 for debug
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
# --- Token Usage Stats APIs ---

@mcp.custom_route("/api/stats/usage", methods=["GET"])
async def api_stats_usage(request):
    """Get daily token usage stats."""
    from starlette.responses import JSONResponse
    try:
        days = int(request.query_params.get("days", 7))
        from usage_tracker import get_tracker
        stats = get_tracker().get_daily_usage(days=days)
        return JSONResponse({"status": "ok", "days": days, "data": stats})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/stats/savings", methods=["GET"])
async def api_stats_savings(request):
    """Get overall cache savings stats."""
    from starlette.responses import JSONResponse
    try:
        days = int(request.query_params.get("days", 30))
        from usage_tracker import get_tracker
        stats = get_tracker().get_savings_stats(days=days)
        return JSONResponse({"status": "ok", "days": days, "data": stats})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/dashboard", methods=["GET"])
async def dashboard(request):
    """Serve the dashboard HTML page."""
    from starlette.responses import HTMLResponse
    import os
    dashboard_path = os.path.join(os.path.dirname(__file__), "dashboard.html")
    try:
        with open(dashboard_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    except FileNotFoundError:
        return HTMLResponse("<h1>dashboard.html not found</h1>", status_code=404)


@mcp.custom_route("/api/config", methods=["GET"])
async def api_config_get(request):
    """Get current runtime config (safe fields only, API key masked)."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    dehy = config.get("dehydration", {})
    awk = config.get("awakening", {})
    drm = config.get("dreaming", {})
    emb = config.get("embedding", {})
    chat_cfg = config.get("chat", {})
    
    def mask(k):
        return f"{k[:4]}...{k[-4:]}" if len(k) > 8 else ("***" if k else "")
        
    return JSONResponse({
        "dehydration": {
            "model": dehy.get("model", ""),
            "base_url": dehy.get("base_url", ""),
            "api_key_masked": mask(dehy.get("api_key", "")),
            "max_tokens": dehy.get("max_tokens", 1024),
            "temperature": dehy.get("temperature", 0.1),
        },
        "awakening": {
            "model": awk.get("model", ""),
            "base_url": awk.get("base_url", ""),
            "api_key_masked": mask(awk.get("api_key", "")),
            "max_tokens": awk.get("max_tokens", 1024),
            "temperature": awk.get("temperature", 0.8),
        },
        "dreaming": {
            "model": drm.get("model", ""),
            "base_url": drm.get("base_url", ""),
            "api_key_masked": mask(drm.get("api_key", "")),
            "max_tokens": drm.get("max_tokens", 2048),
            "temperature": drm.get("temperature", 0.2),
        },
        "chat": {
            "model": chat_cfg.get("model", ""),
            "base_url": chat_cfg.get("base_url", ""),
            "api_key_masked": mask(chat_cfg.get("api_key", "")),
            "max_tokens": chat_cfg.get("max_tokens", 1024),
            "temperature": chat_cfg.get("temperature", 0.7),
        },
        "embedding": {
            "enabled": emb.get("enabled", False),
            "model": emb.get("model", ""),
        },
        "merge_threshold": config.get("merge_threshold", 75),
        "chat_history_limit": config.get("chat_history_limit", 14),
        "transport": config.get("transport", "stdio"),
        "buckets_dir": config.get("buckets_dir", ""),
    })


@mcp.custom_route("/api/config", methods=["POST"])
async def api_config_update(request):
    """Hot-update runtime config. Optionally persist to config.yaml."""
    from starlette.responses import JSONResponse
    import yaml
    err = _require_auth(request)
    if err: return err
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    updated = []

    # --- Dehydration config ---
    if "dehydration" in body:
        d = body["dehydration"]
        dehy = config.setdefault("dehydration", {})
        for key in ("model", "base_url", "max_tokens", "temperature"):
            if key in d:
                dehy[key] = d[key]
                updated.append(f"dehydration.{key}")
        if "api_key" in d and d["api_key"]:
            dehy["api_key"] = d["api_key"]
            updated.append("dehydration.api_key")
        # Hot-reload dehydrator
        dehydrator.model = dehy.get("model", "deepseek-chat")
        dehydrator.base_url = dehy.get("base_url", "")
        dehydrator.api_key = dehy.get("api_key", "")
        dehydrator.api_available = bool(dehydrator.api_key)
        if hasattr(dehydrator, "client") and dehydrator.api_key:
            from openai import AsyncOpenAI
            dehydrator.client = AsyncOpenAI(
                api_key=dehydrator.api_key,
                base_url=dehydrator.base_url,
            )

    # --- Awakening config ---
    if "awakening" in body:
        a = body["awakening"]
        awk = config.setdefault("awakening", {})
        for key in ("model", "base_url", "max_tokens", "temperature"):
            if key in a:
                awk[key] = a[key]
                updated.append(f"awakening.{key}")
        if "api_key" in a and a["api_key"]:
            awk["api_key"] = a["api_key"]
            updated.append("awakening.api_key")
        # Hot-reload awakening_scheduler client
        awakening_scheduler.model = awk.get("model", config.get("dehydration", {}).get("model", "deepseek-chat"))
        awakening_scheduler.max_tokens = awk.get("max_tokens", 1024)
        awakening_scheduler.temperature = awk.get("temperature", 0.8)
        from openai import AsyncOpenAI
        awakening_scheduler._client = AsyncOpenAI(
            api_key=awk.get("api_key", config.get("dehydration", {}).get("api_key", "")),
            base_url=awk.get("base_url", config.get("dehydration", {}).get("base_url", "")),
        )

    # --- Dreaming config ---
    if "dreaming" in body:
        drm_in = body["dreaming"]
        drm = config.setdefault("dreaming", {})
        for key in ("model", "base_url", "max_tokens", "temperature"):
            if key in drm_in:
                drm[key] = drm_in[key]
                updated.append(f"dreaming.{key}")
        if "api_key" in drm_in and drm_in["api_key"]:
            drm["api_key"] = drm_in["api_key"]
            updated.append("dreaming.api_key")
        # Hot-reload dehydrator dreaming client
        dehydrator.dream_model = drm.get("model", config.get("dehydration", {}).get("model", "deepseek-chat"))
        dehydrator.dream_base_url = drm.get("base_url", config.get("dehydration", {}).get("base_url", ""))
        dehydrator.dream_api_key = drm.get("api_key", config.get("dehydration", {}).get("api_key", ""))
        dehydrator.dream_max_tokens = drm.get("max_tokens", 2048)
        dehydrator.dream_temperature = drm.get("temperature", 0.2)
        if dehydrator.dream_api_key:
            from openai import AsyncOpenAI
            dehydrator.dream_client = AsyncOpenAI(
                api_key=dehydrator.dream_api_key,
                base_url=dehydrator.dream_base_url,
                timeout=120.0,
            )
        else:
            dehydrator.dream_client = getattr(dehydrator, "client", None)

    # --- Dedicated Chat config ---
    if "chat" in body:
        c = body["chat"]
        chat_cfg = config.setdefault("chat", {})
        for key in ("model", "base_url", "max_tokens", "temperature"):
            if key in c:
                chat_cfg[key] = c[key]
                updated.append(f"chat.{key}")
        if "api_key" in c and c["api_key"]:
            chat_cfg["api_key"] = c["api_key"]
            updated.append("chat.api_key")
        # Hot-reload dedicated chat client
        global chat_client
        if chat_cfg.get("api_key"):
            from openai import AsyncOpenAI
            chat_client = AsyncOpenAI(
                api_key=chat_cfg["api_key"],
                base_url=chat_cfg.get("base_url") or None,
                timeout=120.0,
            )
        else:
            chat_client = None

    # --- Embedding config ---
    if "embedding" in body:
        e = body["embedding"]
        emb = config.setdefault("embedding", {})
        if "enabled" in e:
            emb["enabled"] = bool(e["enabled"])
            embedding_engine.enabled = emb["enabled"]
            updated.append("embedding.enabled")
        if "model" in e:
            emb["model"] = e["model"]
            embedding_engine.model = emb["model"]
            updated.append("embedding.model")

    # --- Merge threshold ---
    if "merge_threshold" in body:
        config["merge_threshold"] = int(body["merge_threshold"])
        updated.append("merge_threshold")

    # --- Chat history limit ---
    if "chat_history_limit" in body:
        config["chat_history_limit"] = int(body["chat_history_limit"])
        updated.append("chat_history_limit")

    # --- Persist to config.yaml if requested ---
    if body.get("persist", False):
        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yaml")
        try:
            save_config = {}
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    save_config = yaml.safe_load(f) or {}

            if "dehydration" in body:
                sc_dehy = save_config.setdefault("dehydration", {})
                for key in ("model", "base_url", "max_tokens", "temperature"):
                    if key in body["dehydration"]:
                        sc_dehy[key] = body["dehydration"][key]
                        
            if "awakening" in body:
                sc_awk = save_config.setdefault("awakening", {})
                for key in ("model", "base_url", "max_tokens", "temperature"):
                    if key in body["awakening"]:
                        sc_awk[key] = body["awakening"][key]
                        
            if "dreaming" in body:
                sc_drm = save_config.setdefault("dreaming", {})
                for key in ("model", "base_url", "max_tokens", "temperature"):
                    if key in body["dreaming"]:
                        sc_drm[key] = body["dreaming"][key]
                # Never persist api_key to yaml (use env var or keep in memory if user wishes)
                # But actually user configures API key from Dashboard so we might need to save it?
                # The existing code says "Never persist api_key to yaml (use env var)", but if the user inputs it via the drawer, it will be kept in memory but lost on restart.
                # Since this is local app, let's persist api_key if provided because env vars are hard for non-technical users.

            if "chat" in body:
                sc_chat = save_config.setdefault("chat", {})
                for key in ("model", "base_url", "max_tokens", "temperature"):
                    if key in body["chat"]:
                        sc_chat[key] = body["chat"][key]
            
            if "dehydration" in body and "api_key" in body["dehydration"]:
                save_config.setdefault("dehydration", {})["api_key"] = body["dehydration"]["api_key"]
            if "awakening" in body and "api_key" in body["awakening"]:
                save_config.setdefault("awakening", {})["api_key"] = body["awakening"]["api_key"]
            if "dreaming" in body and "api_key" in body["dreaming"]:
                save_config.setdefault("dreaming", {})["api_key"] = body["dreaming"]["api_key"]
            if "chat" in body and "api_key" in body["chat"]:
                save_config.setdefault("chat", {})["api_key"] = body["chat"]["api_key"]

            if "embedding" in body:
                sc_emb = save_config.setdefault("embedding", {})
                for key in ("enabled", "model"):
                    if key in body["embedding"]:
                        sc_emb[key] = body["embedding"][key]

            if "merge_threshold" in body:
                save_config["merge_threshold"] = int(body["merge_threshold"])

            if "chat_history_limit" in body:
                save_config["chat_history_limit"] = int(body["chat_history_limit"])

            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(save_config, f, default_flow_style=False, allow_unicode=True)
            updated.append("persisted_to_yaml")
        except Exception as e:
            return JSONResponse({"error": f"persist failed: {e}", "updated": updated}, status_code=500)

    return JSONResponse({"updated": updated, "ok": True})


@mcp.custom_route("/api/config/test", methods=["POST"])
async def api_config_test(request):
    """Test LLM API connection with provided credentials."""
    from starlette.responses import JSONResponse
    from openai import AsyncOpenAI
    err = _require_auth(request)
    if err: return err
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)
        
    api_key = body.get("api_key", "").strip()
    base_url = body.get("base_url", "").strip()
    model = body.get("model", "").strip()
    tab = body.get("tab", "dehydration").strip()
    
    if not api_key:
        # fallback to the configured key for the requested tab, then dehydration
        tab_cfg = config.get(tab, {})
        api_key = tab_cfg.get("api_key", "")
        if not api_key:
            dehy = config.get("dehydration", {})
            api_key = dehy.get("api_key", "")
        
    if not api_key:
        return JSONResponse({"error": "Missing API Key"}, status_code=400)
        
    try:
        client = AsyncOpenAI(api_key=api_key, base_url=base_url or None, timeout=10.0)
        response = await client.chat.completions.create(
            model=model or "deepseek-chat",
            messages=[{"role": "user", "content": "Ping. Respond with 'Pong'."}],
            max_tokens=10
        )
        msg = response.choices[0].message.content
        return JSONResponse({"ok": True, "message": msg})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# =============================================================
# /api/host-vault — read/write the host-side OMBRE_HOST_VAULT_DIR
# 用于在 Dashboard 设置 docker-compose 挂载的宿主机记忆桶目录。
# 写入项目根目录的 .env 文件，需 docker compose down/up 才能生效。
# =============================================================

def _project_env_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def _read_env_var(name: str) -> str:
    """Return current value of `name` from process env first, then .env file (best-effort)."""
    val = os.environ.get(name, "").strip()
    if val:
        return val
    env_path = _project_env_path()
    if not os.path.exists(env_path):
        return ""
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() == name:
                    return v.strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def _write_env_var(name: str, value: str) -> None:
    """
    Idempotent upsert of `NAME=value` in project .env. Creates the file if missing.
    Preserves other entries verbatim. Quotes values containing spaces.
    """
    env_path = _project_env_path()
    quoted = f'"{value}"' if value and (" " in value or "#" in value) else value
    new_line = f"{name}={quoted}\n"

    lines: list[str] = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    replaced = False
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        k, _, _v = stripped.partition("=")
        if k.strip() == name:
            lines[i] = new_line
            replaced = True
            break
    if not replaced:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(new_line)

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)


@mcp.custom_route("/api/host-vault", methods=["GET"])
async def api_host_vault_get(request):
    """Read the current OMBRE_HOST_VAULT_DIR (process env > project .env)."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    value = _read_env_var("OMBRE_HOST_VAULT_DIR")
    return JSONResponse({
        "value": value,
        "source": "env" if os.environ.get("OMBRE_HOST_VAULT_DIR", "").strip() else ("file" if value else ""),
        "env_file": _project_env_path(),
    })


@mcp.custom_route("/api/host-vault", methods=["POST"])
async def api_host_vault_set(request):
    """
    Persist OMBRE_HOST_VAULT_DIR to the project .env file.
    Body: {"value": "/path/to/vault"}  (empty string clears the entry)
    Note: container restart is required for docker-compose to pick up the new mount.
    """
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    raw = body.get("value", "")
    if not isinstance(raw, str):
        return JSONResponse({"error": "value must be a string"}, status_code=400)
    value = raw.strip()

    # Reject characters that would break .env / shell parsing
    if "\n" in value or "\r" in value or '"' in value or "'" in value:
        return JSONResponse({"error": "value must not contain quotes or newlines"}, status_code=400)

    try:
        _write_env_var("OMBRE_HOST_VAULT_DIR", value)
    except Exception as e:
        return JSONResponse({"error": f"failed to write .env: {e}"}, status_code=500)

    return JSONResponse({
        "ok": True,
        "value": value,
        "env_file": _project_env_path(),
        "note": "已写入 .env；需在宿主机执行 `docker compose down && docker compose up -d` 让新挂载生效。",
    })


# =============================================================
# Import API — conversation history import
# 导入 API — 对话历史导入
# =============================================================

@mcp.custom_route("/api/import/upload", methods=["POST"])
async def api_import_upload(request):
    """Upload a conversation file and start import."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err

    if import_engine.is_running:
        return JSONResponse({"error": "Import already running"}, status_code=409)

    content_type = request.headers.get("content-type", "")
    filename = ""

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            file_field = form.get("file")
            if not file_field:
                return JSONResponse({"error": "No file field"}, status_code=400)
            raw_bytes = await file_field.read()
            filename = getattr(file_field, "filename", "upload")
            raw_content = raw_bytes.decode("utf-8", errors="replace")
        else:
            body = await request.body()
            raw_content = body.decode("utf-8", errors="replace")
            # Try to get filename from query params
            filename = request.query_params.get("filename", "upload")

        if not raw_content.strip():
            return JSONResponse({"error": "Empty file"}, status_code=400)

        preserve_raw = request.query_params.get("preserve_raw", "").lower() in ("1", "true")
        resume = request.query_params.get("resume", "").lower() in ("1", "true")

    except Exception as e:
        return JSONResponse({"error": f"Failed to read upload: {e}"}, status_code=400)

    # Start import in background
    async def _run_import():
        try:
            await import_engine.start(raw_content, filename, preserve_raw, resume)
        except Exception as e:
            logger.error(f"Import failed: {e}")

    asyncio.create_task(_run_import())

    return JSONResponse({
        "status": "started",
        "filename": filename,
        "size_bytes": len(raw_content.encode()),
    })


@mcp.custom_route("/api/import/status", methods=["GET"])
async def api_import_status(request):
    """Get current import progress."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    return JSONResponse(import_engine.get_status())


@mcp.custom_route("/api/import/pause", methods=["POST"])
async def api_import_pause(request):
    """Pause the running import."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    if not import_engine.is_running:
        return JSONResponse({"error": "No import running"}, status_code=400)
    import_engine.pause()
    return JSONResponse({"status": "pause_requested"})


@mcp.custom_route("/api/import/patterns", methods=["GET"])
async def api_import_patterns(request):
    """Detect high-frequency patterns after import."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    try:
        patterns = await import_engine.detect_patterns()
        return JSONResponse({"patterns": patterns})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/import/results", methods=["GET"])
async def api_import_results(request):
    """List recently imported/created buckets for review."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    try:
        limit = int(request.query_params.get("limit", "50"))
        all_buckets = await bucket_mgr.list_all(include_archive=False)
        # Sort by created time, newest first
        all_buckets.sort(key=lambda b: b["metadata"].get("created", ""), reverse=True)
        results = []
        for b in all_buckets[:limit]:
            results.append({
                "id": b["id"],
                "name": b["metadata"].get("name", ""),
                "content": b["content"][:300],
                "type": b["metadata"].get("type", ""),
                "domain": b["metadata"].get("domain", []),
                "tags": b["metadata"].get("tags", []),
                "importance": b["metadata"].get("importance", 5),
                "created": b["metadata"].get("created", ""),
            })
        return JSONResponse({"buckets": results, "total": len(all_buckets)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/import/review", methods=["POST"])
async def api_import_review(request):
    """Apply review decisions: mark buckets as important/noise/pinned."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    decisions = body.get("decisions", [])
    if not decisions:
        return JSONResponse({"error": "No decisions provided"}, status_code=400)

    applied = 0
    errors = 0
    for d in decisions:
        bid = d.get("bucket_id", "")
        action = d.get("action", "")
        if not bid or not action:
            continue
        try:
            if action == "important":
                await bucket_mgr.update(bid, importance=9)
            elif action == "pin":
                await bucket_mgr.update(bid, pinned=True)
            elif action == "noise":
                await bucket_mgr.update(bid, resolved=True, importance=1)
            elif action == "delete":
                file_path = bucket_mgr._find_bucket_file(bid)
                if file_path:
                    os.remove(file_path)
            applied += 1
        except Exception as e:
            logger.warning(f"Review action failed for {bid}: {e}")
            errors += 1

    return JSONResponse({"applied": applied, "errors": errors})


# =============================================================
# /api/status — system status for Dashboard settings tab
# /api/status — Dashboard 设置页用系统状态
# =============================================================
@mcp.custom_route("/api/status", methods=["GET"])
async def api_system_status(request):
    """Return detailed system status for the settings panel."""
    from starlette.responses import JSONResponse
    err = _require_auth(request)
    if err: return err
    try:
        stats = await bucket_mgr.get_stats()
        return JSONResponse({
            "decay_engine": "running" if decay_engine.is_running else "stopped",
            "embedding_enabled": embedding_engine.enabled,
            "buckets": {
                "permanent": stats.get("permanent_count", 0),
                "dynamic": stats.get("dynamic_count", 0),
                "archive": stats.get("archive_count", 0),
                "total": stats.get("permanent_count", 0) + stats.get("dynamic_count", 0),
            },
            "using_env_password": bool(os.environ.get("OMBRE_DASHBOARD_PASSWORD", "")),
            "version": "1.3.0",
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# =============================================================
# Awakening API — scheduler status, log, and configuration
# 觉醒 API —— 调度器状态、日志和配置
# =============================================================
@mcp.custom_route("/api/awakening/status", methods=["GET"])
async def api_awakening_status(request):
    """Return current awakening scheduler status for the PWA control panel."""
    from starlette.responses import JSONResponse
    return JSONResponse(awakening_scheduler.get_status())


@mcp.custom_route("/api/awakening/log", methods=["GET"])
async def api_awakening_log(request):
    """Return recent awakening history."""
    from starlette.responses import JSONResponse
    try:
        limit = int(request.query_params.get("limit", "20"))
    except ValueError:
        limit = 20
    return JSONResponse(awakening_scheduler.get_log(limit=max(1, min(limit, 50))))


@mcp.custom_route("/api/awakening/trigger", methods=["POST"])
async def api_awakening_trigger(request):
    """Manually trigger an awakening cycle (for testing)."""
    from starlette.responses import JSONResponse
    try:
        result = await awakening_scheduler.run_awakening()
        return JSONResponse({"ok": True, "result": result})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@mcp.custom_route("/api/awakening/configure", methods=["POST"])
async def api_awakening_configure(request):
    """Hot-update awakening scheduler settings and optionally persist them."""
    from starlette.responses import JSONResponse
    import yaml

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid JSON"}, status_code=400)

    if not isinstance(body, dict):
        return JSONResponse({"ok": False, "error": "request body must be an object"}, status_code=400)

    persist = bool(body.get("persist", False))
    settings = body.get("scheduler", body)
    if not isinstance(settings, dict):
        return JSONResponse({"ok": False, "error": "scheduler must be an object"}, status_code=400)

    try:
        normalized = awakening_scheduler.configure(settings)
        config["scheduler"] = normalized
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

    updated = ["scheduler"]

    if persist:
        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yaml")
        try:
            save_config = {}
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    save_config = yaml.safe_load(f) or {}
            save_config["scheduler"] = normalized
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(save_config, f, default_flow_style=False, allow_unicode=True)
            updated.append("persisted_to_yaml")
        except Exception as e:
            return JSONResponse(
                {"ok": False, "error": f"persist failed: {e}", "updated": updated},
                status_code=500,
            )

    return JSONResponse({
        "ok": True,
        "updated": updated,
        "scheduler": normalized,
        "status": awakening_scheduler.get_status(),
    })


@mcp.custom_route("/api/private-diary", methods=["GET"])
async def api_private_diary(request):
    """Return private diary entries, redacting content while time-locked."""
    from starlette.responses import JSONResponse

    try:
        limit = int(request.query_params.get("limit", "20"))
    except ValueError:
        limit = 20
    include_locked = request.query_params.get("include_locked", "true").lower() != "false"

    try:
        entries = await bucket_mgr.list_private_entries(
            include_locked=include_locked,
            limit=max(1, min(limit, 50)),
        )
        now = datetime.now()
        payload = []
        for entry in entries:
            meta = entry.get("metadata", {})
            locked_until_raw = meta.get("locked_until")
            locked = False
            if locked_until_raw:
                try:
                    locked = now < datetime.fromisoformat(str(locked_until_raw))
                except (ValueError, TypeError):
                    locked = False

            payload.append({
                "id": entry.get("id"),
                "name": meta.get("name"),
                "created": meta.get("created"),
                "locked": locked,
                "locked_until": locked_until_raw,
                "content": None if locked else entry.get("content", ""),
            })
        return JSONResponse(payload)
    except Exception as e:
        logger.error(f"Private diary API failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


# ============================================================
# Memory CMS APIs
# ============================================================

def _find_core_file(core_id: str) -> str | None:
    if not core_id:
        return None
    core_dir = bucket_mgr.core_dir
    if not os.path.exists(core_dir):
        return None
    for root, _, files in os.walk(core_dir):
        for filename in files:
            if not filename.endswith(".md"):
                continue
            stem = filename[:-3]
            if stem == core_id or stem.endswith(f"_{core_id}"):
                return os.path.join(root, filename)
    return None


@mcp.custom_route("/api/core-memories", methods=["GET"])
async def api_core_memories_get(request):
    """List core context entries from permanent/core/."""
    from starlette.responses import JSONResponse
    try:
        entries = await bucket_mgr.list_core()
        return JSONResponse({"ok": True, "entries": entries})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/core-memories", methods=["POST"])
async def api_core_memories_post(request):
    """Create a protected core context entry under permanent/core/."""
    from starlette.responses import JSONResponse
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    name = str(body.get("name", "")).strip()
    content = str(body.get("content", "")).strip()
    if not content:
        return JSONResponse({"error": "content is required"}, status_code=400)

    core_id = generate_bucket_id()
    title = name or "Core Memory"
    try:
        order = int(body.get("order", 999))
    except Exception:
        order = 999

    metadata = {
        "id": core_id,
        "name": title,
        "type": "core",
        "source": "core_manual",
        "protected": True,
        "domain": ["core"],
        "tags": body.get("tags", []),
        "importance": 10,
        "created": now_iso(),
        "last_active": now_iso(),
        "order": order,
    }
    since = str(body.get("since", "")).strip()
    if since:
        metadata["since"] = since

    try:
        os.makedirs(bucket_mgr.core_dir, exist_ok=True)
        filename = f"{sanitize_name(title)}_{core_id}.md"
        file_path = safe_path(bucket_mgr.core_dir, filename)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(frontmatter.dumps(frontmatter.Post(content, **metadata)))
        return JSONResponse({"ok": True, "entry": bucket_mgr._load_bucket(str(file_path))})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/core-memories/{core_id}", methods=["PUT"])
async def api_core_memories_put(request):
    """Update a core context entry."""
    from starlette.responses import JSONResponse
    core_id = request.path_params["core_id"]
    file_path = _find_core_file(core_id)
    if not file_path:
        return JSONResponse({"error": "Core entry not found"}, status_code=404)

    try:
        body = await request.json()
        post = frontmatter.load(file_path)
        if "name" in body:
            post["name"] = str(body.get("name") or post.get("name") or "Core Memory").strip()
        if "tags" in body and isinstance(body["tags"], list):
            post["tags"] = body["tags"]
        if "order" in body:
            try:
                post["order"] = int(body["order"])
            except Exception:
                pass
        if "since" in body:
            since = str(body.get("since") or "").strip()
            if since:
                post["since"] = since
            elif "since" in post.metadata:
                del post.metadata["since"]
        if "content" in body:
            post.content = str(body.get("content") or "")
        post["last_active"] = now_iso()
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(frontmatter.dumps(post))
        return JSONResponse({"ok": True, "entry": bucket_mgr._load_bucket(file_path)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/core-memories/{core_id}", methods=["DELETE"])
async def api_core_memories_delete(request):
    """Delete a core context entry."""
    from starlette.responses import JSONResponse
    core_id = request.path_params["core_id"]
    file_path = _find_core_file(core_id)
    if not file_path:
        return JSONResponse({"error": "Core entry not found"}, status_code=404)
    try:
        os.remove(file_path)
        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/buckets", methods=["GET"])
async def api_buckets_get(request):
    """Get all buckets for the CMS."""
    from starlette.responses import JSONResponse
    limit = int(request.query_params.get("limit", "100"))
    b_type = request.query_params.get("type", None)
    source = request.query_params.get("source", "").strip().lower()
    scope = request.query_params.get("scope", "").strip().lower()
    
    # bucket_mgr.list_all returns all buckets across all domains
    all_buckets = await bucket_mgr.list_all(include_archive=True)
    
    if b_type:
        all_buckets = [b for b in all_buckets if b.get("metadata", {}).get("type") == b_type]
    if source:
        all_buckets = [
            b for b in all_buckets
            if str(b.get("metadata", {}).get("source", "")).strip().lower() == source
        ]
    if scope == "strata":
        all_buckets = [
            b for b in all_buckets
            if b.get("metadata", {}).get("source") not in STRATA_EXCLUDED_SOURCES
        ]
        
    # Sort by created timestamp descending
    def get_time(b):
        meta = b.get("metadata", {})
        return meta.get("created") or meta.get("last_active") or "1970"
        
    all_buckets.sort(key=get_time, reverse=True)
    return JSONResponse({"ok": True, "buckets": all_buckets[:limit]})


@mcp.custom_route("/api/buckets/{bucket_id}", methods=["GET"])
async def api_bucket_get(request):
    """Get a specific bucket by ID."""
    from starlette.responses import JSONResponse
    bucket_id = request.path_params["bucket_id"]
    try:
        data = await bucket_mgr.get(bucket_id)
        if data:
            return JSONResponse({"ok": True, "bucket": data})
        else:
            return JSONResponse({"error": "Bucket not found"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/buckets/{bucket_id}", methods=["PUT"])
async def api_bucket_put(request):
    """Update a specific bucket."""
    from starlette.responses import JSONResponse
    bucket_id = request.path_params["bucket_id"]
    try:
        body = await request.json()
        success = await bucket_mgr.update(bucket_id, **body)
        if not success:
            return JSONResponse({"error": "Bucket not found"}, status_code=404)
        if "content" in body:
            try:
                await embedding_engine.generate_and_store(bucket_id, str(body["content"]))
            except Exception as e:
                logger.warning(f"Failed to refresh embedding after bucket update: {bucket_id}: {e}")
        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@mcp.custom_route("/api/buckets/{bucket_id}", methods=["DELETE"])
async def api_bucket_delete(request):
    """Delete a specific bucket."""
    from starlette.responses import JSONResponse
    bucket_id = request.path_params["bucket_id"]
    try:
        success = await bucket_mgr.delete(bucket_id)
        if success:
            try:
                embedding_engine.delete_embedding(bucket_id)
            except Exception as e:
                logger.warning(f"Failed to delete embedding for bucket: {bucket_id}: {e}")
            return JSONResponse({"ok": True})
        else:
            return JSONResponse({"error": "Bucket not found or could not be deleted"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Entry point / 启动入口 ---
if __name__ == "__main__":
    transport = config.get("transport", "stdio")
    logger.info(f"Ombre Brain starting | transport: {transport}")

    if transport in ("sse", "streamable-http"):
        import threading
        import uvicorn
        from starlette.middleware.cors import CORSMiddleware

        # --- Application-level keepalive + scheduler start ---
        # --- 应用层保活 + 觉醒调度器启动 ---
        async def _keepalive_loop():
            await asyncio.sleep(10)  # Wait for server to fully start

            # Start awakening scheduler in this async context
            try:
                await awakening_scheduler.start()
                logger.info("Awakening scheduler started from keepalive loop")
            except Exception as e:
                logger.error(f"Failed to start awakening scheduler: {e}")

            async with httpx.AsyncClient() as client:
                while True:
                    try:
                        await client.get(f"http://localhost:{OMBRE_PORT}/health", timeout=5)
                        logger.debug("Keepalive ping OK / 保活 ping 成功")
                    except Exception as e:
                        logger.warning(f"Keepalive ping failed / 保活 ping 失败: {e}")
                    await asyncio.sleep(60)

        def _start_keepalive():
            loop = asyncio.new_event_loop()
            loop.run_until_complete(_keepalive_loop())

        t = threading.Thread(target=_start_keepalive, daemon=True)
        t.start()

        # --- Add CORS middleware so remote clients (Cloudflare Tunnel / ngrok) can connect ---
        # --- 添加 CORS 中间件，让远程客户端（Cloudflare Tunnel / ngrok）能正常连接 ---
        if transport == "streamable-http":
            _app = mcp.streamable_http_app()
        else:
            _app = mcp.sse_app()
        _app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["*"],
        )
        logger.info("CORS middleware enabled for remote transport / 已启用 CORS 中间件")
        uvicorn.run(_app, host="0.0.0.0", port=OMBRE_PORT)
    else:
        mcp.run(transport=transport)
