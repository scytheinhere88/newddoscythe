"""Backend test suite for Resilience Testing Dashboard."""
import os
import time
import uuid
import requests
import pytest
from pymongo import MongoClient
from bson import ObjectId

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://check-enhance-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@resilience.lab"
ADMIN_PASSWORD = "admin123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "resilience_db")

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def mongo_db():
    cli = MongoClient(MONGO_URL)
    yield cli[DB_NAME]
    cli.close()


@pytest.fixture(scope="module")
def admin_session():
    """Login as admin and return session with cookies."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def new_user_session():
    """Register a fresh user."""
    s = requests.Session()
    email = f"TEST_user_{uuid.uuid4().hex[:8]}@lab.io"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "test1234", "name": "T"}, timeout=15)
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    s.email = email  # type: ignore[attr-defined]
    return s


# ---------------------------------------------------------------------------
# Auth tests
# ---------------------------------------------------------------------------
class TestAuth:
    def test_register_new_user(self):
        s = requests.Session()
        email = f"TEST_reg_{uuid.uuid4().hex[:8]}@lab.io"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Reg"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == email.lower()  # backend normalizes to lowercase
        assert "id" in body
        # cookie should be set
        assert "access_token" in s.cookies.get_dict()

    def test_register_duplicate_email(self, new_user_session):
        r = requests.post(f"{API}/auth/register",
                          json={"email": new_user_session.email, "password": "abcdef", "name": "Dup"}, timeout=15)
        assert r.status_code == 400

    def test_login_admin(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        assert "access_token" in s.cookies.get_dict()
        data = r.json()
        assert data["email"] == ADMIN_EMAIL

    def test_login_invalid_password(self):
        r = requests.post(f"{API}/auth/login",
                         json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_returns_current_user(self, admin_session):
        r = admin_session.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == ADMIN_EMAIL
        assert "id" in body
        assert "password_hash" not in body

    def test_logout_clears_cookies(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        r = s.post(f"{API}/auth/logout", timeout=15)
        assert r.status_code == 200
        # cookies cleared - subsequent /auth/me should 401
        r2 = s.get(f"{API}/auth/me", timeout=15)
        assert r2.status_code == 401


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
class TestProjects:
    def test_list_requires_auth(self):
        r = requests.get(f"{API}/projects", timeout=15)
        assert r.status_code == 401

    def test_create_and_list(self, new_user_session):
        # Initially empty
        r = new_user_session.get(f"{API}/projects", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        initial_n = len(r.json())

        domain = f"test-{uuid.uuid4().hex[:6]}.example.com"
        r = new_user_session.post(f"{API}/projects",
                                  json={"name": "TEST_proj", "domain": domain, "description": "x"}, timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["domain"] == domain
        assert p["verified"] is False
        assert p["verify_token"].startswith("resilience-verify=")
        assert "id" in p

        # GET verifies persistence
        r2 = new_user_session.get(f"{API}/projects", timeout=15)
        assert len(r2.json()) == initial_n + 1

    def test_create_duplicate_domain(self, new_user_session):
        domain = f"dup-{uuid.uuid4().hex[:6]}.example.com"
        r1 = new_user_session.post(f"{API}/projects", json={"name": "p1", "domain": domain}, timeout=15)
        assert r1.status_code == 200
        r2 = new_user_session.post(f"{API}/projects", json={"name": "p2", "domain": domain}, timeout=15)
        assert r2.status_code == 400

    def test_invalid_domain_format(self, new_user_session):
        r = new_user_session.post(f"{API}/projects", json={"name": "bad", "domain": "not-a-domain"}, timeout=15)
        assert r.status_code == 422

    def test_verify_returns_token_info(self, new_user_session):
        domain = f"ver-{uuid.uuid4().hex[:6]}.example.com"
        r = new_user_session.post(f"{API}/projects", json={"name": "vproj", "domain": domain}, timeout=15)
        pid = r.json()["id"]
        rv = new_user_session.post(f"{API}/projects/{pid}/verify", timeout=20)
        # may be 200 with verified=false or 500 if DNS fails for non-existent domain
        assert rv.status_code in (200, 500)
        if rv.status_code == 200:
            body = rv.json()
            assert body["verified"] is False
            assert "expected_token" in body
            assert "expected_host" in body
            assert body["expected_host"] == f"_resilience.{domain}"

    def test_delete_project(self, new_user_session):
        domain = f"del-{uuid.uuid4().hex[:6]}.example.com"
        r = new_user_session.post(f"{API}/projects", json={"name": "delp", "domain": domain}, timeout=15)
        pid = r.json()["id"]
        rd = new_user_session.delete(f"{API}/projects/{pid}", timeout=15)
        assert rd.status_code == 200
        # confirm not in list
        listed = new_user_session.get(f"{API}/projects", timeout=15).json()
        assert pid not in [p["id"] for p in listed]


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
class TestStats:
    def test_stats_overview_shape(self, admin_session):
        r = admin_session.get(f"{API}/stats/overview", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("projects", "verified_projects", "tests_total", "tests_running",
                  "peak_rps_recent", "limits"):
            assert k in body
        lim = body["limits"]
        assert lim["max_rps"] == 5000
        assert lim["max_duration_sec"] == 600
        assert lim["max_vus"] == 2000

    def test_stats_requires_auth(self):
        r = requests.get(f"{API}/stats/overview", timeout=15)
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# Tests (k6 runner)
# ---------------------------------------------------------------------------
class TestTestRunner:
    def test_create_test_unverified_returns_403(self, new_user_session):
        domain = f"unver-{uuid.uuid4().hex[:6]}.example.com"
        rp = new_user_session.post(f"{API}/projects", json={"name": "unv", "domain": domain}, timeout=15)
        pid = rp.json()["id"]
        rt = new_user_session.post(f"{API}/tests", json={
            "project_id": pid, "name": "TEST_smoke", "test_type": "smoke",
            "target_path": "/", "target_rps": 5, "duration_sec": 10, "vus": 2,
        }, timeout=15)
        assert rt.status_code == 403
        assert "verified" in rt.text.lower()

    def test_safety_caps(self, new_user_session, mongo_db):
        # Create + force-verify a project against example.com
        domain = "example.com"
        # Cleanup any prior test project for this user with example.com
        rp = new_user_session.post(f"{API}/projects", json={"name": "cap", "domain": domain}, timeout=15)
        if rp.status_code == 400:
            # already exists for this user — find it
            for p in new_user_session.get(f"{API}/projects").json():
                if p["domain"] == domain:
                    pid = p["id"]
                    break
        else:
            pid = rp.json()["id"]
        mongo_db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"verified": True}})

        # target_rps too high
        r = new_user_session.post(f"{API}/tests", json={
            "project_id": pid, "name": "cap1", "test_type": "smoke", "target_path": "/",
            "target_rps": 6000, "duration_sec": 10, "vus": 2,
        }, timeout=15)
        assert r.status_code in (400, 422)

        # duration too long
        r = new_user_session.post(f"{API}/tests", json={
            "project_id": pid, "name": "cap2", "test_type": "smoke", "target_path": "/",
            "target_rps": 5, "duration_sec": 700, "vus": 2,
        }, timeout=15)
        assert r.status_code in (400, 422)

        # vus too high
        r = new_user_session.post(f"{API}/tests", json={
            "project_id": pid, "name": "cap3", "test_type": "smoke", "target_path": "/",
            "target_rps": 5, "duration_sec": 10, "vus": 5000,
        }, timeout=15)
        assert r.status_code in (400, 422)

    def test_full_test_flow_smoke(self, new_user_session, mongo_db):
        # ensure example.com project verified for this user
        existing = [p for p in new_user_session.get(f"{API}/projects").json() if p["domain"] == "example.com"]
        if existing:
            pid = existing[0]["id"]
        else:
            rp = new_user_session.post(f"{API}/projects", json={"name": "ex", "domain": "example.com"}, timeout=15)
            pid = rp.json()["id"]
        mongo_db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"verified": True}})

        # Create smoke test
        rt = new_user_session.post(f"{API}/tests", json={
            "project_id": pid, "name": "TEST_smoke_run", "test_type": "smoke",
            "target_path": "/", "target_rps": 5, "duration_sec": 10, "vus": 2,
        }, timeout=20)
        assert rt.status_code == 200, rt.text
        test_id = rt.json()["id"]
        assert rt.json()["status"] == "queued"

        # Poll until finished (max 30s)
        final = None
        for _ in range(20):
            time.sleep(2)
            r = new_user_session.get(f"{API}/tests/{test_id}", timeout=15)
            assert r.status_code == 200
            data = r.json()
            if data["status"] in ("completed", "failed", "aborted"):
                final = data
                break
        assert final is not None, "Test did not finish within 40s"
        # status either completed or failed (k6 threshold). Both acceptable.
        assert final["status"] in ("completed", "failed")
        summary = final.get("summary") or {}
        for k in ("total_requests", "peak_rps", "p50", "p95", "p99", "error_rate", "status_codes"):
            assert k in summary, f"missing summary field {k}"
        assert summary["total_requests"] > 0
        assert isinstance(final.get("recommendations"), list)

        # metrics endpoint
        rm = new_user_session.get(f"{API}/tests/{test_id}/metrics", timeout=15)
        assert rm.status_code == 200
        m = rm.json()
        assert "points" in m and isinstance(m["points"], list)
        if m["points"]:
            p = m["points"][0]
            for k in ("ts", "rps", "errors", "p50", "p95", "p99"):
                assert k in p

    def test_abort_running_test(self, new_user_session, mongo_db):
        existing = [p for p in new_user_session.get(f"{API}/projects").json() if p["domain"] == "example.com"]
        pid = existing[0]["id"]
        mongo_db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"verified": True}})
        rt = new_user_session.post(f"{API}/tests", json={
            "project_id": pid, "name": "TEST_abort", "test_type": "soak",
            "target_path": "/", "target_rps": 5, "duration_sec": 30, "vus": 2,
        }, timeout=20)
        assert rt.status_code == 200
        test_id = rt.json()["id"]
        time.sleep(3)
        ra = new_user_session.post(f"{API}/tests/{test_id}/abort", timeout=15)
        assert ra.status_code == 200
        time.sleep(2)
        r = new_user_session.get(f"{API}/tests/{test_id}", timeout=15)
        assert r.status_code == 200
        # status should be aborted (or failed if k6 had already finished)
        assert r.json()["status"] in ("aborted", "failed", "completed")
