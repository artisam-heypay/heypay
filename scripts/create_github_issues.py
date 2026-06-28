#!/usr/bin/env python3
"""Create GitHub labels + issues for HeyPay plan tasks.

- Reads docs/superpowers/issues/sprint-N.json (produced by extract_issues_from_plans.py).
- Creates labels: sprint-1..9, one area label per phase, and a `plan-task` label.
- Creates one issue per task with title `Sprint N · Task M: <title>`, body from the
  JSON, and labels: sprint-N, area, plan-task.
- Idempotent: skips issues whose exact title already exists in the repo.
"""
from __future__ import annotations
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ISSUES_DIR = Path("docs/superpowers/issues")

# (label, color, description)
SPRINT_META = {
    1: ("sprint-1", "0e8a16", "Sprint 1 — Foundation & Infra"),
    2: ("sprint-2", "1d76db", "Sprint 2 — Auth & Sessions"),
    3: ("sprint-3", "5319e7", "Sprint 3 — Core Services"),
    4: ("sprint-4", "d93f0b", "Sprint 4 — Payment Rail"),
    5: ("sprint-5", "b60205", "Sprint 5 — Payments & Worker"),
    6: ("sprint-6", "006b75", "Sprint 6 — Payer UI"),
    7: ("sprint-7", "fbca04", "Sprint 7 — Merchant UI"),
    8: ("sprint-8", "6f42c1", "Sprint 8 — Admin UI"),
    9: ("sprint-9", "6e7781", "Sprint 9 — Testing & Deploy"),
}
AREA_META = {
    "foundation": ("foundation", "0e8a16", "Foundation & infra"),
    "auth": ("auth", "1d76db", "Auth & sessions"),
    "services": ("services", "5319e7", "Core services (crypto/stellar/qrph/storage)"),
    "rail": ("rail", "d93f0b", "Payment rail (mock/PDAX)"),
    "payments-worker": ("payments-worker", "b60205", "Payments domain + settlement worker"),
    "payer-ui": ("payer-ui", "006b75", "Payer-facing UI"),
    "merchant-ui": ("merchant-ui", "fbca04", "Merchant-facing UI"),
    "admin-ui": ("admin-ui", "6f42c1", "Admin-facing UI"),
    "testing-deploy": ("testing-deploy", "6e7781", "Testing, quality gates, deploy"),
}
PLAN_TASK_LABEL = ("plan-task", "0969da", "Task derived from docs/superpowers/plans")


def gh(*args, check=True, capture=True) -> str:
    res = subprocess.run(
        ["gh", *args],
        check=check,
        text=True,
        capture_output=capture,
    )
    return res.stdout if capture else ""


def ensure_label(name: str, color: str, desc: str) -> None:
    try:
        gh("label", "create", name, "--color", color, "--description", desc, "--force")
        print(f"  label: {name}")
    except subprocess.CalledProcessError as e:
        # Already exists without --force support? Try update path.
        print(f"  label: {name} (exists: {e.stderr.strip()[:80] if e.stderr else ''})")


def existing_issue_titles() -> set[str]:
    try:
        out = gh("issue", "list", "--state", "all", "--limit", "500",
                 "--json", "title", "--jq", ".[].title")
    except subprocess.CalledProcessError:
        return set()
    return {line.strip() for line in out.splitlines() if line.strip()}


def main():
    print("== Creating labels ==")
    for _, (name, color, desc) in SPRINT_META.items():
        ensure_label(name, color, desc)
    for _, (name, color, desc) in AREA_META.items():
        ensure_label(name, color, desc)
    ensure_label(*PLAN_TASK_LABEL)

    existing = existing_issue_titles()
    print(f"\n== Existing issues: {len(existing)} (will skip title collisions) ==")

    created = 0
    skipped = 0
    for sprint in range(1, 10):
        path = ISSUES_DIR / f"sprint-{sprint}.json"
        tasks = json.loads(path.read_text(encoding="utf-8"))
        sprint_label = SPRINT_META[sprint][0]
        for t in tasks:
            area = t["area"]
            area_label = AREA_META.get(area, (area, "6e7781", area))[0]
            title = f"Sprint {sprint} · Task {t['number']}: {t['title']}"
            if title in existing:
                skipped += 1
                continue
            # Write body to a temp file to avoid shell-escaping issues.
            with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False,
                                             encoding="utf-8") as bf:
                bf.write(t["body"])
                body_path = bf.name
            try:
                url = gh("issue", "create",
                         "--title", title,
                         "--body-file", body_path,
                         "--label", sprint_label,
                         "--label", area_label,
                         "--label", PLAN_TASK_LABEL[0]).strip()
                created += 1
                print(f"  [s{sprint} t{t['number']}] #{url.rsplit('/',1)[-1]}  {title[:70]}")
            finally:
                Path(body_path).unlink(missing_ok=True)
            existing.add(title)

    print(f"\n== Done. created={created} skipped={skipped} ==")


if __name__ == "__main__":
    main()