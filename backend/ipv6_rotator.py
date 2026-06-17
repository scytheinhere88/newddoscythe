"""IPv6 rotation engine for the Resilience Testing Dashboard.

- Detects if the host has a global IPv6 /64 subnet bound to a non-loopback iface.
- Generates random IPv6 addresses within that /64 subnet.
- Adds them to the interface via `ip -6 addr add` (needs CAP_NET_ADMIN).
- Provides graceful fallback for restricted environments (e.g. K8s preview).
- After a test run, removes the addresses to keep the system clean.

The k6 `localIPs` option (k6 >= 0.51) consumes a comma-separated list of source
IPs; each VU iteration round-robins through them, presenting many unique
source addresses to the target server.
"""

from __future__ import annotations

import os
import re
import asyncio
import ipaddress
import secrets
import logging
from typing import Optional

logger = logging.getLogger("resilience.ipv6")

# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

async def _run(cmd: list[str], timeout: float = 4.0) -> tuple[int, str, str]:
    """Run a subprocess and capture stdout/stderr."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode or 0, out.decode("utf-8", "ignore"), err.decode("utf-8", "ignore")
    except Exception as e:
        return -1, "", str(e)


async def detect_ipv6_capability() -> dict:
    """Detect IPv6 /64 subnet + whether we can add addresses to it."""
    result = {
        "available": False,
        "mode": "unavailable",      # 'live' | 'simulation' | 'unavailable'
        "subnet": None,             # e.g. '2a01:4f9:c011:abcd::/64'
        "interface": None,          # e.g. 'eth0'
        "primary_addr": None,
        "can_rotate": False,
        "max_concurrent_addrs": 0,
        "reason": "",
    }

    # 1. Check if any global IPv6 address exists
    rc, out, err = await _run(["ip", "-6", "-o", "addr", "show", "scope", "global"])
    if rc != 0 and not out:
        result["reason"] = "ip command failed; host does not appear to have IPv6 tooling"
        return result

    # Parse `ip -6 -o addr show scope global` output, e.g.:
    #   2: eth0    inet6 2a01:4f9:c011:abcd::1/64 scope global ...
    iface = None
    primary = None
    subnet = None
    for line in out.splitlines():
        m = re.match(r"\d+:\s+(\S+)\s+inet6\s+([0-9a-fA-F:]+)/(\d+)", line)
        if not m:
            continue
        ifn, addr, prefix = m.group(1), m.group(2), int(m.group(3))
        if ifn == "lo":
            continue
        try:
            ip = ipaddress.IPv6Address(addr)
        except ValueError:
            continue
        if ip.is_loopback or ip.is_link_local or ip.is_unspecified:
            continue
        # We need a /64 (or smaller prefix => bigger subnet) to rotate
        if prefix > 64:
            continue
        net = ipaddress.IPv6Network(f"{addr}/{prefix}", strict=False)
        iface, primary, subnet = ifn, str(ip), str(net)
        break

    if not subnet:
        result["reason"] = "no global IPv6 /64 subnet found on this host"
        return result

    result["available"] = True
    result["subnet"] = subnet
    result["interface"] = iface
    result["primary_addr"] = primary

    # 2. Check if we can add addresses (CAP_NET_ADMIN)
    test_addr = generate_random_ipv6(subnet)
    rc_add, _, err_add = await _run(["ip", "-6", "addr", "add", f"{test_addr}/128",
                                     "dev", iface, "preferred_lft", "60", "valid_lft", "60"])
    if rc_add == 0:
        # Cleanup the test address
        await _run(["ip", "-6", "addr", "del", f"{test_addr}/128", "dev", iface])
        result["mode"] = "live"
        result["can_rotate"] = True
        # kernel cap: ~10k secondary addrs per iface but be conservative
        result["max_concurrent_addrs"] = 2000
        result["reason"] = "ready: can add and bind random IPv6 from /64"
    else:
        result["mode"] = "simulation"
        result["can_rotate"] = False
        result["reason"] = f"insufficient privileges ({err_add.strip()[:120]}). Deploy to your own VPS with root for live IPv6 rotation."
    return result


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def generate_random_ipv6(subnet_cidr: str) -> str:
    """Pick a uniformly-random address inside the given subnet."""
    net = ipaddress.IPv6Network(subnet_cidr, strict=False)
    # Random offset within the host bits
    host_bits = 128 - net.prefixlen
    if host_bits <= 0:
        return str(net.network_address)
    # Avoid the network address itself
    offset = 1 + secrets.randbelow((1 << host_bits) - 1)
    return str(ipaddress.IPv6Address(int(net.network_address) + offset))


def generate_address_pool(subnet_cidr: str, count: int) -> list[str]:
    """Generate `count` unique random IPv6 addresses from the /64."""
    pool = set()
    while len(pool) < count:
        pool.add(generate_random_ipv6(subnet_cidr))
    return list(pool)


# ---------------------------------------------------------------------------
# Apply / Cleanup
# ---------------------------------------------------------------------------

async def add_addresses(interface: str, addrs: list[str]) -> tuple[int, list[str]]:
    """Add a list of IPv6 addresses to the interface. Returns (success_count, errors)."""
    ok = 0
    errors: list[str] = []
    # Bulk via `ip -batch` isn't available everywhere; do them sequentially
    for a in addrs:
        rc, _, err = await _run(
            ["ip", "-6", "addr", "add", f"{a}/128", "dev", interface,
             "preferred_lft", "1800", "valid_lft", "1800"],
            timeout=1.0,
        )
        if rc == 0:
            ok += 1
        else:
            if len(errors) < 5:
                errors.append(f"{a}: {err.strip()[:80]}")
    return ok, errors


async def remove_addresses(interface: str, addrs: list[str]) -> int:
    """Remove a list of IPv6 addresses from the interface."""
    removed = 0
    for a in addrs:
        rc, _, _ = await _run(
            ["ip", "-6", "addr", "del", f"{a}/128", "dev", interface],
            timeout=1.0,
        )
        if rc == 0:
            removed += 1
    return removed
