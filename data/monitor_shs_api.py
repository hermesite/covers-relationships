#!/usr/bin/env python3
"""Monitor SecondHandSongs API availability and optionally run generation."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from generate_graph_data import SHS_API


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monitor SecondHandSongs API availability")
    parser.add_argument("--artist", type=int, default=14076, help="Artist ID used for the availability probe.")
    parser.add_argument("--base-url", default=os.environ.get("SHS_BASE_URL", SHS_API), help="API base URL.")
    parser.add_argument("--proxy", help="Authorized HTTP/HTTPS proxy URL, for example http://host:port.")
    parser.add_argument("--interval-seconds", type=int, default=900, help="Seconds between probes (default: 900).")
    parser.add_argument("--once", action="store_true", help="Probe once instead of waiting for recovery.")
    parser.add_argument(
        "--run-band-detail",
        action="store_true",
        help="Run generate_band_detail.py after the API becomes available.",
    )
    return parser.parse_args()


def timestamp() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def error_message(exc: HTTPError) -> str:
    try:
        payload = json.loads(exc.read().decode("utf-8"))
        error = payload.get("error") or {}
        if error.get("message"):
            message = " ".join(str(error["message"]).split())
            return f"API {error.get('code')}: {message}"
    except (AttributeError, json.JSONDecodeError, UnicodeDecodeError):
        pass
    return str(exc.reason)


def probe(base_url: str, artist: int, proxy: str | None) -> tuple[bool, str]:
    handlers = []
    if proxy:
        handlers.append(ProxyHandler({"http": proxy, "https": proxy}))
    opener = build_opener(*handlers)
    request = Request(
        f"{base_url.rstrip('/')}/artist/{artist}",
        headers={
            "Accept": "application/json",
            "User-Agent": "secondhand-covers-availability-monitor/1.0",
            **({"X-API-Key": os.environ["SHS_API_KEY"]} if os.environ.get("SHS_API_KEY") else {}),
        },
    )
    try:
        with opener.open(request, timeout=30) as response:
            json.loads(response.read().decode("utf-8"))
            return True, f"HTTP {response.status}"
    except HTTPError as exc:
        return False, f"HTTP {exc.code}: {error_message(exc)}"
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        return False, f"network/response error: {exc}"


def run_band_detail(artist: int, base_url: str, proxy: str | None) -> int:
    script = Path(__file__).with_name("generate_band_detail.py")
    env = os.environ.copy()
    if proxy:
        env.update({"HTTP_PROXY": proxy, "HTTPS_PROXY": proxy})
    command = [sys.executable, str(script), "--artist", str(artist)]
    return subprocess.run(command, env=env, check=False).returncode


def main() -> int:
    args = parse_args()
    if args.interval_seconds < 60 and not args.once:
        print("--interval-seconds must be at least 60 to avoid excessive API probes.", file=sys.stderr)
        return 2

    while True:
        available, detail = probe(args.base_url, args.artist, args.proxy)
        state = "available" if available else "unavailable"
        print(f"[{timestamp()}] SecondHandSongs API {state}: {detail}", flush=True)
        if available:
            if args.run_band_detail:
                return run_band_detail(args.artist, args.base_url, args.proxy)
            return 0
        if args.once:
            return 1
        print(f"Next probe in {args.interval_seconds} seconds.", flush=True)
        time.sleep(args.interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())