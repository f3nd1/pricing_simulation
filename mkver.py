# -*- coding: utf-8 -*-
"""Stamp APP_VERSION/APP_BUILD and rebuild APP_CHANGELOG from git history.

Idempotent: strips any existing stamp block before writing a new one. An earlier
version replaced only the changelog line, leaving the previous const APP_VERSION
behind -- a duplicate const is a fatal SyntaxError that blanks the whole app.
Self-checks for duplicates before saving. Always run cba.check.mjs afterwards.
"""
import subprocess, json, datetime, sys

MARK = "/* Build stamp."
f = "ucc_budget_simulator.html"
s = open(f, encoding="utf-8").read()

log = subprocess.check_output(
    ["git", "log", "--date=format:%Y-%m-%d|%H:%M", "--pretty=format:%h|%ad|%s"],
    text=True, encoding="utf-8")
entries = []
for line in log.splitlines():
    parts = line.split("|", 3)
    if len(parts) == 4:
        h, d, t, subj = parts
        entries.append({"h": h, "d": d, "t": t, "s": subj})

ver = f"v1.{len(entries) + 1}.0"
today = datetime.date.today().isoformat()

# cut from the start of any existing stamp (or the changelog line) through the
# end of the changelog line, so repeated runs collapse instead of stacking
cl = s.index("const APP_CHANGELOG=")
start = s.index(MARK) if MARK in s and s.index(MARK) < cl else cl
end = s.index("\n", cl)

block = (MARK + " APP_VERSION is what the Change Log shows so you can tell at a\n"
         "   glance whether a machine is running the latest file. Regenerate with mkver.py. */\n"
         f'const APP_VERSION="{ver}";\nconst APP_BUILD="{today}";\n'
         "const APP_CHANGELOG=" + json.dumps(entries, ensure_ascii=False) + ";")
s = s[:start] + block + s[end:]

for ident in ("const APP_VERSION", "const APP_BUILD", "const APP_CHANGELOG"):
    if s.count(ident) != 1:
        sys.exit(f"ABORT: {ident} appears {s.count(ident)} times -- would break the app")

open(f, "w", encoding="utf-8").write(s)
print(f"{ver} build {today} · {len(entries)} entries, newest {entries[0]['h']}")
