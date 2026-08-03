"""
Extract all personas and scenarios from JS files for thesis appendix
"""
import os
import re
import json

base_path = r"d:\Projects\MMT\Chatbot\Brainwasher 3\training\simulation"

def extract_js_objects(file_path, export_name):
    """Extract JavaScript object exports"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Find the export statement
        pattern = rf'export const {export_name}\s*=\s*\{{(.*?)\}};'
        match = re.search(pattern, content, re.DOTALL)
        
        if not match:
            return {}
        
        obj_content = match.group(1)
        
        # Extract individual scenario/persona keys and names
        items = {}
        # Match pattern: key: { name: '...', description: '...', ... }
        key_pattern = r'(\w+):\s*\{[^}]*name:\s*[\'"]([^\'"]+)[\'"][^}]*description:\s*[\'"]([^\'"]+)[\'"]'
        
        for key_match in re.finditer(key_pattern, obj_content):
            key = key_match.group(1)
            name = key_match.group(2)
            desc = key_match.group(3)
            items[key] = {'name': name, 'description': desc}
        
        return items
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return {}

# Extract personas
personas_path = os.path.join(base_path, "personas", "personas.js")
print("Extracting Patient Personas...")
patient_personas = extract_js_objects(personas_path, "PATIENT_PERSONAS")
print(f"Found {len(patient_personas)} patient personas")

print("\nExtracting Caregiver Personas...")
caregiver_personas = extract_js_objects(personas_path, "CAREGIVER_PERSONAS")
print(f"Found {len(caregiver_personas)} caregiver personas")

print("\nExtracting Doctor Personas...")
doctor_personas = extract_js_objects(personas_path, "DOCTOR_PERSONAS")
print(f"Found {len(doctor_personas)} doctor personas")

# Extract scenarios from each file
scenarios_path = os.path.join(base_path, "scenarios")
scenario_files = [
    "basic_scenarios.js",
    "avoidance_scenarios.js",
    "future_planning_scenarios.js",
    "caregiver_scenarios.js",
    "privacy_scenarios.js",
    "multi_user_scenarios.js",
    "deception_scenarios.js",
    "conflict_scenarios.js",
    "escalation_scenarios.js",
    "longitudinal_scenarios.js",
    "complex_scenarios.js",
    "stress_test_scenarios.js",
    "environmental_scenarios.js",
    "cultural_scenarios.js",
    "practical_scenarios.js",
    "preventative_scenarios.js",
    "misconception_scenarios.js",
    "curative_scenarios.js",
    "palliative_scenarios.js",
    "ethical_scenarios.js",
    "family_dynamics_scenarios.js",
    "psychology_scenarios.js",
    "lifestyle_scenarios.js",
    "behavior_change_scenarios.js",
    "professional_scenarios.js",
    "document_scenarios.js",
    "notification_scenarios.js",
    "composite_scenarios.js",
]

all_scenarios = {}
for filename in scenario_files:
    file_path = os.path.join(scenarios_path, filename)
    if not os.path.exists(file_path):
        continue
    
    # Extract export name from filename
    export_name = filename.replace('.js', '').upper()
    
    print(f"\nExtracting {filename}...")
    scenarios = extract_js_objects(file_path, export_name)
    print(f"  Found {len(scenarios)} scenarios")
    all_scenarios.update(scenarios)

# Write output
output = {
    'patient_personas': patient_personas,
    'caregiver_personas': caregiver_personas,
    'doctor_personas': doctor_personas,
    'scenarios': all_scenarios
}

output_path = r"d:\Projects\MMT\Chatbot\Brainwasher 3\phd\extracted_personas_scenarios.json"
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"\n{'='*80}")
print(f"SUMMARY")
print(f"{'='*80}")
print(f"Patient Personas: {len(patient_personas)}")
print(f"Caregiver Personas: {len(caregiver_personas)}")
print(f"Doctor Personas: {len(doctor_personas)}")
print(f"Total Scenarios: {len(all_scenarios)}")
print(f"\nOutput saved to: {output_path}")
