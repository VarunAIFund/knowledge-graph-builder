"""
Test embedding search. Usage: python3 test_search.py [query...]
"""
import sys, json, urllib.request, urllib.error

BASE = "http://localhost:5001"

def post(path, body):
    data = json.dumps(body).encode()
    req  = urllib.request.Request(f"{BASE}{path}", data=data,
                                   headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

try:
    urllib.request.urlopen(f"{BASE}/api/files", timeout=5)
except Exception as e:
    print(f"✗ Backend not reachable: {e}"); sys.exit(1)

queries = sys.argv[1:] or ["schedule"]

for query in queries:
    print(f"\n{'─'*60}\nQuery: '{query}'")
    try:
        resp = post("/api/search", {"query": query, "limit": 20})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print("  ✗ Restart Flask server to activate /api/search")
        else:
            print(f"  ✗ HTTP {e.code}")
        continue

    results = resp.get("results", [])
    sem_q   = resp.get("semantic_query", query)
    tf      = resp.get("type_filter")
    print(f"  semantic='{sem_q}'  type_filter={tf}")
    print(f"  method={resp.get('method')}  {len(results)} results\n")
    for r in results:
        name    = r.get("name","?")
        score   = r.get("score", 0)
        ftype   = r.get("type","?")
        preview = (r.get("preview") or "")[:70].replace("\n"," ")
        marker  = " ◄" if "schedule" in name.lower() or "screenshot" in name.lower() else ""
        print(f"  {score:.3f}  [{ftype:7}]  {name}{marker}")
        if preview and preview not in (f"[Image] {name}", f"PDF: {name}"):
            print(f"           {preview}")
print()
