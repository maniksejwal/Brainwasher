"""Debug: print raw scorer LLM text before json.loads."""
import sys, os, json, re, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from tensornets.a3c.scorer import _SCORING_PROMPT, _build_prompt, _TENSORNETS_URL

# Minimal call
patient_msg   = "I feel really anxious."
agent_resp    = "I hear you. Can you tell me more?"
prompt = _build_prompt(patient_msg, agent_resp, 0, "behaviour_change", "precontemplation", "establish trust", "", [])

body = json.dumps({
    "system": "You are a clinical conversation evaluator. Output ONLY a raw JSON object. No preamble, no markdown, no comments. Start your response with { and end with }.",
    "prompt": prompt,
    "max_tokens": 900
}).encode()

r = urllib.request.urlopen(
    urllib.request.Request(f"{_TENSORNETS_URL}/llm/scout", data=body, headers={"Content-Type":"application/json"}),
    timeout=30
)
data = json.loads(r.read())
text = data.get("text","").strip()
print("=== RAW (first 800 chars) ===")
print(repr(text[:800]))
print("\n=== LINES ===")
for i, ln in enumerate(text.split("\n")[:15]):
    print(f"  {i+1:2}: {repr(ln)}")
