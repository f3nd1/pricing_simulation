# -*- coding: utf-8 -*-
import subprocess, json, datetime
log = subprocess.check_output(
    ["git","log","--date=format:%Y-%m-%d|%H:%M","--pretty=format:%h|%ad|%s"],
    text=True, encoding="utf-8")
entries=[]
for line in log.splitlines():
    if not line.strip(): continue
    parts=line.split("|",3)
    if len(parts)<4: continue
    h,d,t,subj=parts
    entries.append({"h":h,"d":d,"t":t,"s":subj})
n=len(entries)+1                       # this build = next commit
ver=f"v1.{n}.0"
today=datetime.date.today().isoformat()
f="ucc_budget_simulator.html"; s=open(f,encoding="utf-8").read()

# replace the whole changelog array line
import re
start=s.index("const APP_CHANGELOG=")
end=s.index("\n",start)
block=("/* Build stamp. APP_VERSION is what the Change Log shows so you can tell at a\n"
       "   glance whether a machine is running the latest file. Bump both when deploying. */\n"
       f'const APP_VERSION="{ver}";\nconst APP_BUILD="{today}";\n'
       "const APP_CHANGELOG="+json.dumps(entries,ensure_ascii=False)+";")
s=s[:start]+block+s[end:]
open(f,"w",encoding="utf-8").write(s)
print(f"{ver} build {today} · {len(entries)} changelog entries, newest {entries[0]['h']}")
