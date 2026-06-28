#!/usr/bin/env python3
"""Extract GitHub-issue-shaped tasks from HeyPay phase plans.

Each phase file (docs/superpowers/plans/2026-06-28-heypay-NN-*.md) maps to one
sprint (NN -> sprint N). Each `## Task N <delim> Title` or `### Task N <delim>
Title` block becomes one issue. The full markdown body of the block (everything
until the next Task heading or a `## Self-Review` heading) becomes the issue
body, prefixed with a source-reference line.

Output: docs/superpowers/issues/sprint-N.json  (array of issue objects)
"""
from __future__ import annotations
import json
import re
from pathlib import Path

PLANS_DIR = Path("docs/superpowers/plans")
OUT_DIR = Path("docs/superpowers/issues")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Sprint number + area slug come from the filename: heypay-NN-<area>.md
FILE_RE = re.compile(r"heypay-(\d{2})-([a-z0-9-]+)\.md$")
# Task heading: `## Task 3 — Title` / `### Task 1: Title` / `## Task 3 - Title`
# Delimiters: em dash, en dash, colon, hyphen.
TASK_RE = re.compile(r"^(#{2,3})\s+Task\s+(\d+)\s*[—:–-]\s+(.+?)\s*$")
# Headings that terminate a task block.
STOP_RE = re.compile(r"^#{2,4}\s+(Task\s+\d+|Self-Review)\b")

# Friendly sprint titles from the overview phase index.
SPRINT_TITLES = {
    1: "Foundation & Infra",
    2: "Auth & Sessions",
    3: "Core Services",
    4: "Payment Rail",
    5: "Payments & Worker",
    6: "Payer UI",
    7: "Merchant UI",
    8: "Admin UI",
    9: "Testing & Deploy",
}


def split_tasks(path: Path, sprint: int, area: str) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    tasks: list[dict] = []
    cur = None  # current task dict
    body_buf: list[str] = []

    def flush():
        nonlocal cur, body_buf
        if cur is None:
            return
        body = "\n".join(body_buf).strip()
        ref = f"**Source plan:** `{path.name}` · Task {cur['number']}"
        cur["body"] = ref + "\n\n---\n\n" + body
        tasks.append(cur)
        cur = None
        body_buf = []

    for line in lines:
        m = TASK_RE.match(line)
        if m:
            flush()
            num = int(m.group(2))
            title = m.group(3).strip()
            cur = {
                "sprint": sprint,
                "area": area,
                "number": num,
                "title": title,
                "heading": f"Task {num}: {title}",
            }
            body_buf = []
            continue
        if cur is not None:
            if STOP_RE.match(line):
                # Next task heading or Self-Review ends the current block.
                # But a Task heading was already handled above; this catches
                # Self-Review (which uses ## or ###) only.
                if not TASK_RE.match(line):
                    flush()
                    continue
            body_buf.append(line)
    flush()
    return tasks


def main():
    all_issues: list[dict] = []
    for path in sorted(PLANS_DIR.glob("*-heypay-0[1-9]-*.md")):
        m = FILE_RE.search(path.name)
        if not m:
            continue
        sprint = int(m.group(1))
        area = m.group(2)
        tasks = split_tasks(path, sprint, area)
        # Stable order by task number.
        tasks.sort(key=lambda t: t["number"])
        out = OUT_DIR / f"sprint-{sprint}.json"
        out.write_text(json.dumps(tasks, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"sprint {sprint} ({area}): {len(tasks)} tasks -> {out}")
        all_issues.extend(tasks)
    total = len(all_issues)
    print(f"---\nTOTAL: {total} issues across 9 sprints")
    return total


if __name__ == "__main__":
    main()