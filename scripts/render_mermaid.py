"""
Render Mermaid diagrams to PNG using mermaid-py or subprocess call to mmdc
"""
import subprocess
import sys
from pathlib import Path

# Check if mermaid-cli (mmdc) is available
try:
    result = subprocess.run(['mmdc', '--version'], 
                          capture_output=True, text=True, timeout=5)
    has_mmdc = result.returncode == 0
except (FileNotFoundError, subprocess.TimeoutExpired):
    has_mmdc = False

if not has_mmdc:
    print("\nERROR: mermaid-cli (mmdc) not found!")
    print("\nTo install:")
    print("  npm install -g @mermaid-js/mermaid-cli")
    print("\nAlternative: Copy the Mermaid code to https://mermaid.live/ and export manually")
    sys.exit(1)

# Mermaid source file
mermaid_file = Path('figures/care_circle_mermaid.md')

if not mermaid_file.exists():
    print(f"ERROR: {mermaid_file} not found!")
    sys.exit(1)

# Read and extract the first Mermaid diagram
content = mermaid_file.read_text()

# Extract first mermaid block
start = content.find('```mermaid')
if start == -1:
    print("ERROR: No mermaid diagram found!")
    sys.exit(1)

start += len('```mermaid\n')
end = content.find('```', start)
mermaid_code = content[start:end].strip()

# Write to temporary file
temp_file = Path('figures/temp_mermaid.mmd')
temp_file.write_text(mermaid_code)

# Render to PNG
output_file = Path('figures/care_circle_flow_diagram.png')
cmd = ['mmdc', '-i', str(temp_file), '-o', str(output_file), 
       '-b', 'white', '-t', 'default', '-w', '1200']

print(f"\nRendering Mermaid diagram to {output_file}...")
result = subprocess.run(cmd, capture_output=True, text=True)

if result.returncode == 0:
    print(f"SUCCESS: {output_file} created!")
    temp_file.unlink()  # Clean up
else:
    print(f"ERROR: {result.stderr}")
    sys.exit(1)
