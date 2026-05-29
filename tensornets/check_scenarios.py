from tensornets.a3c.scenario_loader import load_scenarios
scenarios = load_scenarios()
multi  = [s for s in scenarios if len(s.get('users', [{'role':'patient'}])) > 1]
single = [s for s in scenarios if len(s.get('users', [{'role':'patient'}])) == 1]

print(f"Multi-role scenarios ({len(multi)}):")
for s in multi:
    roles = [u.get('role') for u in s.get('users', [])]
    sid = s.get('scenario_id','?')
    print(f"  {sid:<45s} roles={roles}")

print(f"\nSingle-patient only ({len(single)}):")
for s in single:
    print(f"  {s.get('scenario_id')}")

print("\nescalation in required_elements:")
for s in scenarios:
    els = s.get('required_elements', [])
    if any('escal' in str(e).lower() or 'caregiver' in str(e).lower() for e in els):
        print(f"  {s.get('scenario_id')}: {els}")

print("\nAll action sets in scenario configs:")
all_actions = set()
for s in scenarios:
    all_actions.update(s.get('allowed_actions', []))
print("  escalate" in all_actions or "escalate in actions:", "escalate" in all_actions)
for s in scenarios:
    if "escalate" in s.get("allowed_actions", []):
        print(f"  {s.get('scenario_id')} has escalate action")
