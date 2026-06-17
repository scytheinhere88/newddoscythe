from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import json
import bcrypt
import jwt as pyjwt
import secrets
import asyncio
import logging
import tempfile
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import dns.resolver
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field, EmailStr, field_validator
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
MAX_RPS = int(os.environ.get("MAX_RPS", 5000))
MAX_DURATION_SEC = int(os.environ.get("MAX_DURATION_SEC", 600))
MAX_VUS = int(os.environ.get("MAX_VUS", 2000))

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Resilience Testing Dashboard")
api = APIRouter(prefix="/api")

RUNNING_TESTS: dict[str, dict] = {}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("resilience")

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email,
               "exp": datetime.now(timezone.utc) + timedelta(hours=8),
               "type": "access"}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id,
               "exp": datetime.now(timezone.utc) + timedelta(days=7),
               "type": "refresh"}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False,
                        samesite="lax", max_age=8 * 3600, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False,
                        samesite="lax", max_age=7 * 24 * 3600, path="/")

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["id"] = str(user.pop("_id"))
        user.pop("password_hash", None)
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    domain: str = Field(min_length=3, max_length=255)
    description: Optional[str] = None

    @field_validator("domain")
    @classmethod
    def _normalize_domain(cls, v: str) -> str:
        v = v.strip().lower()
        v = re.sub(r"^https?://", "", v)
        v = v.split("/")[0]
        if not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", v):
            raise ValueError("Invalid domain format")
        return v

class ScenarioIn(BaseModel):
    project_id: str
    name: str = Field(min_length=1, max_length=80)
    test_type: Literal["smoke", "ramp", "spike", "soak", "stress", "breakpoint"]
    target_path: str = Field(default="/", max_length=255)
    method: Literal["GET", "POST", "HEAD"] = "GET"
    target_rps: int = Field(ge=1, le=MAX_RPS)
    duration_sec: int = Field(ge=5, le=MAX_DURATION_SEC)
    vus: int = Field(ge=1, le=MAX_VUS)
    headers: Optional[dict] = None
    body: Optional[str] = None

# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def _startup():
    await db.users.create_index("email", unique=True)
    await db.projects.create_index([("user_id", 1), ("domain", 1)])
    await db.tests.create_index([("user_id", 1), ("created_at", -1)])
    await db.tests.create_index([("project_id", 1), ("created_at", -1)])
    await db.test_metrics.create_index([("test_id", 1), ("ts", 1)])

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@resilience.lab").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded admin user")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )

# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already registered")
    user_doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name or email.split("@")[0],
        "role": "user",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.users.insert_one(user_doc)
    uid = str(res.inserted_id)
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": user_doc["name"], "role": "user"}

@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    uid = str(user["_id"])
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": user.get("name"), "role": user.get("role", "user")}

@api.post("/auth/logout")
async def logout(response: Response, _u: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

@api.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    rt = request.cookies.get("refresh_token")
    if not rt:
        raise HTTPException(401, "No refresh token")
    try:
        payload = pyjwt.decode(rt, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(401, "Invalid token type")
        uid = payload["sub"]
        user = await db.users.find_one({"_id": ObjectId(uid)})
        if not user:
            raise HTTPException(401, "User not found")
        response.set_cookie("access_token", create_access_token(uid, user["email"]),
                            httponly=True, secure=False, samesite="lax",
                            max_age=8 * 3600, path="/")
        return {"ok": True}
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid refresh token")

# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
def _project_out(d: dict) -> dict:
    return {
        "id": str(d["_id"]),
        "name": d["name"],
        "domain": d["domain"],
        "description": d.get("description"),
        "verified": d.get("verified", False),
        "verify_token": d.get("verify_token"),
        "created_at": d.get("created_at"),
        "last_test_at": d.get("last_test_at"),
        "test_count": d.get("test_count", 0),
    }

@api.get("/projects")
async def list_projects(user: dict = Depends(get_current_user)):
    rows = await db.projects.find({"user_id": user["id"]}).sort("created_at", -1).to_list(200)
    return [_project_out(r) for r in rows]

@api.post("/projects")
async def create_project(payload: ProjectIn, user: dict = Depends(get_current_user)):
    if await db.projects.find_one({"user_id": user["id"], "domain": payload.domain}):
        raise HTTPException(400, "Project with that domain already exists")
    token = "resilience-verify=" + secrets.token_urlsafe(24)
    doc = {
        "user_id": user["id"],
        "name": payload.name,
        "domain": payload.domain,
        "description": payload.description,
        "verified": False,
        "verify_token": token,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "test_count": 0,
    }
    res = await db.projects.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _project_out(doc)

@api.get("/projects/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    doc = await db.projects.find_one({"_id": ObjectId(project_id), "user_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Project not found")
    return _project_out(doc)

@api.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    res = await db.projects.delete_one({"_id": ObjectId(project_id), "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Project not found")
    await db.tests.delete_many({"project_id": project_id, "user_id": user["id"]})
    return {"ok": True}

@api.post("/projects/{project_id}/verify")
async def verify_project(project_id: str, user: dict = Depends(get_current_user)):
    doc = await db.projects.find_one({"_id": ObjectId(project_id), "user_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Project not found")
    if doc.get("verified"):
        return {"verified": True, "message": "Already verified"}
    domain = doc["domain"]
    token = doc["verify_token"]
    resolver = dns.resolver.Resolver()
    resolver.lifetime = 8.0
    candidates = [f"_resilience.{domain}", domain]
    found = False
    records_seen: list[str] = []
    for candidate in candidates:
        try:
            answers = resolver.resolve(candidate, "TXT")
            for r in answers:
                txt = b"".join(r.strings).decode("utf-8", errors="ignore")
                records_seen.append(f"{candidate}: {txt}")
                if token in txt:
                    found = True
                    break
        except Exception as e:
            logger.info(f"DNS lookup for {candidate} failed: {e}")
            continue
        if found:
            break
    if not found:
        return {
            "verified": False,
            "message": "TXT record not found yet (DNS may take time to propagate).",
            "expected_token": token,
            "expected_host": f"_resilience.{domain}",
            "records_seen": records_seen,
        }
    await db.projects.update_one({"_id": doc["_id"]}, {"$set": {"verified": True}})
    return {"verified": True, "message": "Domain ownership verified"}

# ---------------------------------------------------------------------------
# k6 runner
# ---------------------------------------------------------------------------
K6_SCRIPT_TEMPLATE = r"""
import http from 'k6/http';
import { check } from 'k6';

export const options = __OPTIONS__;

const headers = __HEADERS__;
const body = __BODY__;
const targetUrl = __URL__;
const method = __METHOD__;

export default function () {
  let res;
  if (method === 'GET' || method === 'HEAD') {
    res = http.request(method, targetUrl, null, { headers });
  } else {
    res = http.request(method, targetUrl, body || null, { headers });
  }
  check(res, { 'status<500': (r) => r.status < 500 });
}
"""

def build_k6_options(scenario: ScenarioIn) -> dict:
    t = scenario.test_type
    dur = f"{scenario.duration_sec}s"
    rps = scenario.target_rps
    vus = scenario.vus

    if t == "smoke":
        return {"vus": min(2, vus), "duration": dur,
                "thresholds": {"http_req_failed": ["rate<0.05"]}}
    if t == "ramp":
        third = max(2, int(scenario.duration_sec / 3))
        return {"stages": [
            {"duration": f"{third}s", "target": max(1, int(vus / 2))},
            {"duration": f"{third}s", "target": vus},
            {"duration": f"{third}s", "target": 0},
        ]}
    if t == "spike":
        return {"stages": [
            {"duration": "10s", "target": 5},
            {"duration": "10s", "target": vus},
            {"duration": f"{max(10, scenario.duration_sec - 30)}s", "target": vus},
            {"duration": "10s", "target": 0},
        ]}
    if t == "soak":
        return {"vus": vus, "duration": dur}
    if t == "stress":
        quarter = max(2, int(scenario.duration_sec / 4))
        return {"stages": [
            {"duration": f"{quarter}s", "target": max(1, int(vus / 3))},
            {"duration": f"{quarter}s", "target": max(1, int(2 * vus / 3))},
            {"duration": f"{quarter}s", "target": vus},
            {"duration": f"{quarter}s", "target": 0},
        ]}
    if t == "breakpoint":
        return {
            "scenarios": {"breakpoint": {
                "executor": "ramping-arrival-rate",
                "startRate": 1, "timeUnit": "1s",
                "preAllocatedVUs": vus,
                "maxVUs": vus,
                "stages": [{"duration": dur, "target": rps}],
            }},
        }
    return {"vus": vus, "duration": dur}

def render_k6_script(scenario: ScenarioIn, full_url: str) -> str:
    options = build_k6_options(scenario)
    options.setdefault("summaryTrendStats", ["min", "med", "avg", "p(90)", "p(95)", "p(99)", "max"])
    options.setdefault("discardResponseBodies", True)
    return (K6_SCRIPT_TEMPLATE
            .replace("__OPTIONS__", json.dumps(options))
            .replace("__HEADERS__", json.dumps(scenario.headers or {}))
            .replace("__BODY__", json.dumps(scenario.body or ""))
            .replace("__URL__", json.dumps(full_url))
            .replace("__METHOD__", json.dumps(scenario.method)))

async def stream_k6_output(test_id: str, proc: asyncio.subprocess.Process):
    cur_bucket = None
    buf = {"http_reqs": 0, "http_req_failed": 0, "durations": [],
           "status_codes": {}, "checks_ok": 0, "checks_fail": 0}

    async def flush(ts: int):
        if buf["http_reqs"] == 0 and buf["http_req_failed"] == 0 and not buf["durations"]:
            return
        durs = sorted(buf["durations"]) if buf["durations"] else [0.0]
        n = len(durs)
        def pct(p): return durs[min(n - 1, max(0, int(n * p / 100)))]
        point = {
            "test_id": test_id, "ts": ts,
            "rps": buf["http_reqs"], "errors": buf["http_req_failed"],
            "p50": pct(50), "p95": pct(95), "p99": pct(99),
            "avg": sum(durs) / n if durs else 0,
            "max": durs[-1] if durs else 0,
            "status_codes": buf["status_codes"],
            "checks_ok": buf["checks_ok"], "checks_fail": buf["checks_fail"],
        }
        await db.test_metrics.insert_one(point)

    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        try:
            obj = json.loads(line.decode("utf-8", errors="ignore").strip())
        except Exception:
            continue
        if obj.get("type") != "Point":
            continue
        metric = obj.get("metric")
        data = obj.get("data", {})
        t = data.get("time")
        if not t:
            continue
        try:
            tdt = datetime.fromisoformat(t.replace("Z", "+00:00"))
        except Exception:
            continue
        sec = int(tdt.timestamp())
        if cur_bucket is None:
            cur_bucket = sec
        if sec != cur_bucket:
            await flush(cur_bucket)
            buf = {"http_reqs": 0, "http_req_failed": 0, "durations": [],
                   "status_codes": {}, "checks_ok": 0, "checks_fail": 0}
            cur_bucket = sec
        v = data.get("value", 0)
        tags = data.get("tags", {})
        if metric == "http_reqs":
            buf["http_reqs"] += int(v)
            code = str(tags.get("status", "?"))
            buf["status_codes"][code] = buf["status_codes"].get(code, 0) + int(v)
        elif metric == "http_req_failed":
            if v == 1:
                buf["http_req_failed"] += 1
        elif metric == "http_req_duration":
            buf["durations"].append(float(v))
        elif metric == "checks":
            if v == 1:
                buf["checks_ok"] += 1
            else:
                buf["checks_fail"] += 1
    if cur_bucket is not None:
        await flush(cur_bucket)

async def run_k6_subprocess(test_id: str, script: str):
    tmpdir = tempfile.mkdtemp(prefix="k6_")
    script_path = os.path.join(tmpdir, "script.js")
    with open(script_path, "w") as f:
        f.write(script)
    cmd = ["k6", "run", "--out", "json=-", "--quiet", "--no-summary", "--no-color", script_path]
    logger.info(f"Starting k6 for {test_id}")
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    RUNNING_TESTS[test_id] = {"proc": proc, "started_at": datetime.now(timezone.utc).isoformat()}
    await db.tests.update_one({"_id": ObjectId(test_id)},
                              {"$set": {"status": "running",
                                        "started_at": datetime.now(timezone.utc).isoformat()}})
    err_tail = ""
    try:
        await stream_k6_output(test_id, proc)
        rc = await proc.wait()
        err_tail = (await proc.stderr.read()).decode("utf-8", errors="ignore")[-2000:]
        status = "completed" if rc == 0 else "failed"
        await finalize_test(test_id, status, err_tail)
    except Exception as e:
        logger.exception("k6 run failed")
        await finalize_test(test_id, "failed", str(e))
    finally:
        RUNNING_TESTS.pop(test_id, None)
        try:
            os.remove(script_path)
            os.rmdir(tmpdir)
        except Exception:
            pass

async def finalize_test(test_id: str, status: str, log_tail: str = ""):
    points = await db.test_metrics.find({"test_id": test_id}).sort("ts", 1).to_list(10000)
    if not points:
        summary = {"total_requests": 0, "total_errors": 0, "peak_rps": 0,
                   "avg_rps": 0, "p50": 0, "p95": 0, "p99": 0,
                   "error_rate": 0.0, "duration_sec": 0, "breakpoint_rps": 0,
                   "status_codes": {}}
    else:
        total_req = sum(p["rps"] for p in points)
        total_err = sum(p["errors"] for p in points)
        peak_rps = max(p["rps"] for p in points)
        avg_rps = total_req / len(points)
        p50 = sorted(p["p50"] for p in points)[len(points) // 2]
        p95 = max(p["p95"] for p in points)
        p99 = max(p["p99"] for p in points)
        codes_agg: dict = {}
        for p in points:
            for k, v in (p.get("status_codes") or {}).items():
                codes_agg[k] = codes_agg.get(k, 0) + v
        breakpoint_rps = 0
        for p in points:
            if p["rps"] > 0 and p["errors"] / max(1, p["rps"]) > 0.10:
                breakpoint_rps = p["rps"]
                break
        summary = {
            "total_requests": total_req, "total_errors": total_err,
            "peak_rps": peak_rps, "avg_rps": round(avg_rps, 2),
            "p50": round(p50, 2), "p95": round(p95, 2), "p99": round(p99, 2),
            "error_rate": round((total_err / max(1, total_req)) * 100, 2),
            "duration_sec": len(points), "breakpoint_rps": breakpoint_rps,
            "status_codes": codes_agg,
        }
    recos = generate_recommendations(summary)
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": {"status": status,
                  "ended_at": datetime.now(timezone.utc).isoformat(),
                  "summary": summary, "recommendations": recos,
                  "log_tail": log_tail}},
    )

def generate_recommendations(s: dict) -> list:
    out = []
    err = s.get("error_rate", 0)
    p95 = s.get("p95", 0)
    bp = s.get("breakpoint_rps", 0)
    peak = s.get("peak_rps", 0)
    codes = s.get("status_codes") or {}

    if err > 5:
        out.append({"severity": "high",
                    "title": "High error rate detected",
                    "detail": f"Error rate is {err}%. Investigate 5xx responses, DB pool exhaustion, worker timeouts. Tune upstream timeouts and your app's request pool."})
    elif err > 1:
        out.append({"severity": "medium",
                    "title": "Elevated error rate",
                    "detail": f"Error rate is {err}%. Add circuit breakers and retry-with-backoff on dependencies."})

    if p95 > 1000:
        out.append({"severity": "high",
                    "title": "p95 latency above 1s",
                    "detail": f"p95 = {p95}ms. Add caching (Redis/CDN), enable HTTP/2 + keep-alive, profile slow DB queries."})
    elif p95 > 300:
        out.append({"severity": "medium",
                    "title": "p95 latency above 300ms",
                    "detail": f"p95 = {p95}ms. Add response caching headers and pre-warm common endpoints."})

    if bp and bp < peak * 0.7:
        out.append({"severity": "high",
                    "title": "Early breakpoint detected",
                    "detail": f"Errors exceeded 10% at ~{bp} RPS while peak was {peak} RPS. Configure nginx limit_req, graceful 429 with Retry-After."})

    if str(429) in codes or str(503) in codes:
        out.append({"severity": "info",
                    "title": "Throttling responses observed",
                    "detail": "429/503 returned. Tune CDN cache hit and nginx limit_req_zone."})

    if peak < 100 and s.get("total_requests", 0) > 0:
        out.append({"severity": "info",
                    "title": "Low peak throughput",
                    "detail": f"Peak was only {peak} RPS. If target is single-process PHP/Python, scale workers (PM2/Gunicorn -w N)."})

    out.append({"severity": "info",
                "title": "Hardening checklist",
                "detail": "1) CDN + Bot Fight Mode, 2) nginx limit_req + limit_conn, 3) Brotli/Gzip compression, 4) HTTP/2 + keep-alive, 5) Redis cache for hot paths, 6) Fail2Ban on auth, 7) Security headers (HSTS, CSP)."})
    return out

# ---------------------------------------------------------------------------
# Test routes
# ---------------------------------------------------------------------------
@api.post("/tests")
async def create_test(scenario: ScenarioIn, user: dict = Depends(get_current_user)):
    if scenario.target_rps > MAX_RPS:
        raise HTTPException(400, f"target_rps > {MAX_RPS}")
    if scenario.duration_sec > MAX_DURATION_SEC:
        raise HTTPException(400, f"duration_sec > {MAX_DURATION_SEC}")
    if scenario.vus > MAX_VUS:
        raise HTTPException(400, f"vus > {MAX_VUS}")

    proj = await db.projects.find_one({"_id": ObjectId(scenario.project_id), "user_id": user["id"]})
    if not proj:
        raise HTTPException(404, "Project not found")
    if not proj.get("verified"):
        raise HTTPException(403, "Project domain not verified. Add DNS TXT record first.")

    domain = proj["domain"]
    path = scenario.target_path if scenario.target_path.startswith("/") else "/" + scenario.target_path
    full_url = f"https://{domain}{path}"

    doc = {
        "user_id": user["id"],
        "project_id": scenario.project_id,
        "domain": domain,
        "name": scenario.name,
        "test_type": scenario.test_type,
        "config": scenario.model_dump(),
        "target_url": full_url,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "summary": None,
        "recommendations": [],
    }
    res = await db.tests.insert_one(doc)
    test_id = str(res.inserted_id)
    await db.projects.update_one(
        {"_id": proj["_id"]},
        {"$set": {"last_test_at": doc["created_at"]}, "$inc": {"test_count": 1}},
    )
    script = render_k6_script(scenario, full_url)
    asyncio.create_task(run_k6_subprocess(test_id, script))
    return {"id": test_id, "status": "queued", "target_url": full_url}

@api.get("/tests")
async def list_tests(project_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"user_id": user["id"]}
    if project_id:
        q["project_id"] = project_id
    rows = await db.tests.find(q).sort("created_at", -1).to_list(200)
    return [{
        "id": str(r["_id"]),
        "project_id": r["project_id"],
        "name": r["name"],
        "test_type": r["test_type"],
        "domain": r["domain"],
        "target_url": r["target_url"],
        "status": r["status"],
        "created_at": r["created_at"],
        "started_at": r.get("started_at"),
        "ended_at": r.get("ended_at"),
        "summary": r.get("summary"),
    } for r in rows]

@api.get("/tests/{test_id}")
async def get_test(test_id: str, user: dict = Depends(get_current_user)):
    r = await db.tests.find_one({"_id": ObjectId(test_id), "user_id": user["id"]})
    if not r:
        raise HTTPException(404, "Test not found")
    return {
        "id": str(r["_id"]),
        "project_id": r["project_id"],
        "name": r["name"],
        "test_type": r["test_type"],
        "domain": r["domain"],
        "target_url": r["target_url"],
        "config": r.get("config"),
        "status": r["status"],
        "created_at": r["created_at"],
        "started_at": r.get("started_at"),
        "ended_at": r.get("ended_at"),
        "summary": r.get("summary"),
        "recommendations": r.get("recommendations") or [],
        "log_tail": r.get("log_tail", ""),
    }

@api.get("/tests/{test_id}/metrics")
async def get_test_metrics(test_id: str, since_ts: Optional[int] = None,
                           user: dict = Depends(get_current_user)):
    t = await db.tests.find_one({"_id": ObjectId(test_id), "user_id": user["id"]})
    if not t:
        raise HTTPException(404, "Test not found")
    q = {"test_id": test_id}
    if since_ts:
        q["ts"] = {"$gt": since_ts}
    pts = await db.test_metrics.find(q).sort("ts", 1).to_list(5000)
    return {
        "test_id": test_id,
        "status": t["status"],
        "summary": t.get("summary"),
        "points": [{
            "ts": p["ts"], "rps": p["rps"], "errors": p["errors"],
            "p50": round(p["p50"], 2), "p95": round(p["p95"], 2), "p99": round(p["p99"], 2),
            "avg": round(p["avg"], 2), "max": round(p["max"], 2),
            "status_codes": p.get("status_codes", {}),
        } for p in pts],
    }

@api.post("/tests/{test_id}/abort")
async def abort_test(test_id: str, user: dict = Depends(get_current_user)):
    t = await db.tests.find_one({"_id": ObjectId(test_id), "user_id": user["id"]})
    if not t:
        raise HTTPException(404, "Test not found")
    entry = RUNNING_TESTS.get(test_id)
    if entry:
        try:
            entry["proc"].terminate()
        except Exception:
            pass
        await asyncio.sleep(0.5)
        try:
            entry["proc"].kill()
        except Exception:
            pass
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": {"status": "aborted", "ended_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}

# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
@api.get("/stats/overview")
async def stats_overview(user: dict = Depends(get_current_user)):
    proj_count = await db.projects.count_documents({"user_id": user["id"]})
    verified = await db.projects.count_documents({"user_id": user["id"], "verified": True})
    tests_total = await db.tests.count_documents({"user_id": user["id"]})
    tests_running = await db.tests.count_documents({"user_id": user["id"], "status": "running"})
    peak_rps = 0
    avg_rps_acc, err_rate_acc = [], []
    async for t in db.tests.find({"user_id": user["id"], "status": "completed"}).sort("created_at", -1).limit(20):
        s = t.get("summary") or {}
        if s.get("peak_rps", 0) > peak_rps:
            peak_rps = s["peak_rps"]
        if s.get("avg_rps"):
            avg_rps_acc.append(s["avg_rps"])
        if s.get("error_rate") is not None:
            err_rate_acc.append(s["error_rate"])
    return {
        "projects": proj_count,
        "verified_projects": verified,
        "tests_total": tests_total,
        "tests_running": tests_running,
        "peak_rps_recent": peak_rps,
        "avg_rps_recent": round(sum(avg_rps_acc) / len(avg_rps_acc), 2) if avg_rps_acc else 0,
        "avg_error_rate_recent": round(sum(err_rate_acc) / len(err_rate_acc), 2) if err_rate_acc else 0,
        "limits": {"max_rps": MAX_RPS, "max_duration_sec": MAX_DURATION_SEC, "max_vus": MAX_VUS},
    }

@api.get("/")
async def root():
    return {"service": "resilience", "status": "ok"}

# ---------------------------------------------------------------------------
# Mount
# ---------------------------------------------------------------------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def _shutdown():
    for tid, entry in list(RUNNING_TESTS.items()):
        try:
            entry["proc"].terminate()
        except Exception:
            pass
    client.close()
