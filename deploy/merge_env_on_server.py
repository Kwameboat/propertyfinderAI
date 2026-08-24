import pathlib,re
target=pathlib.Path("/opt/jab-hub/.env")
extra=pathlib.Path("/tmp/marketing-merge.env")
text=target.read_text() if target.exists() else ""
for line in extra.read_text().splitlines():
  if not line.strip() or line.startswith("#"): continue
  k,v=line.split("=",1)
  pat=re.compile("^"+re.escape(k)+"=.*$", re.M)
  text=pat.sub(k+"="+v,text) if pat.search(text) else text.rstrip()+"\n"+k+"="+v+"\n"
target.write_text(text)
