"""
Generate improved Care Circle architecture diagram - CLEAN VERSION
No HTN, better terminology, professional design
"""
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle
import matplotlib.lines as mlines

fig, ax = plt.subplots(figsize=(10, 14))
ax.set_xlim(0, 10)
ax.set_ylim(0, 16)
ax.axis('off')

# Professional color scheme
color_endpoint = '#3498db'      # Blue
color_coordinator = '#9b59b6'   # Purple
color_llm = '#f39c12'           # Orange
color_logic = '#e74c3c'         # Red
color_guard = '#27ae60'         # Green
color_actions = '#34495e'       # Dark gray

def draw_box(ax, x, y, width, height, text, subtitle='', color='white', 
             textcolor='white', border_width=2.5):
    """Draw a rounded box with text"""
    box = FancyBboxPatch((x, y), width, height, 
                         boxstyle="round,pad=0.1", 
                         edgecolor=color, 
                         facecolor=color, 
                         linewidth=border_width,
                         alpha=0.9)
    ax.add_patch(box)
    
    if subtitle:
        ax.text(x + width/2, y + height*0.62, text, 
                ha='center', va='center', 
                fontsize=11, fontweight='bold', color=textcolor)
        ax.text(x + width/2, y + height*0.32, subtitle, 
                ha='center', va='center', 
                fontsize=9, color=textcolor, style='italic')
    else:
        ax.text(x + width/2, y + height/2, text, 
                ha='center', va='center', 
                fontsize=11, fontweight='bold', color=textcolor)

def draw_arrow(ax, x1, y1, x2, y2, color='#2c3e50', width=2.5):
    """Draw arrow between boxes"""
    arrow = FancyArrowPatch((x1, y1), (x2, y2),
                           arrowstyle='->', 
                           color=color, 
                           linewidth=width,
                           mutation_scale=25)
    ax.add_patch(arrow)

# Title
ax.text(5, 15.8, 'Care Circle: Multi-Agent Coordination', 
        ha='center', fontsize=16, fontweight='bold', color='#2c3e50')
ax.text(5, 15.3, 'Experiment 0 (JavaScript Implementation)', 
        ha='center', fontsize=10, style='italic', color='#7f8c8d')

# USER
y = 14.5
draw_box(ax, 3.5, y, 3, 0.8, 'User Message', '', 
         color=color_endpoint, textcolor='white')

draw_arrow(ax, 5, y, 5, y-0.6, color='#2c3e50', width=2.5)

# COORDINATOR
y = 13.2
draw_box(ax, 3, y, 4, 0.85, 'Companion Coordinator', 'Message Router', 
         color=color_coordinator, textcolor='white')

draw_arrow(ax, 5, y, 5, y-0.6, color='#2c3e50', width=2.5)

# PIPELINE STAGES
stages = [
    (11.8, '① Intent Handler', 'LLM Call #1 · Command Detection', color_llm, '~400 tokens'),
    (10.4, '② Privacy Guard', 'Consent Tier Enforcement', color_guard, 'Filter'),
    (9.0, '③ AI Analysis', 'LLM Call #2 · Sentiment + Criticality', color_llm, '~350 tokens'),
    (7.6, '④ Action Executor', 'Policy Selection (A3C)', color_logic, 'Tabular softmax'),
    (6.2, '⑤ Response Generator', 'LLM Call #3 · Generate Reply', color_llm, '~450 tokens'),
]

for y_pos, title, subtitle, color, note in stages:
    draw_box(ax, 2.5, y_pos, 5, 0.9, title, subtitle, 
             color=color, textcolor='white')
    ax.text(2.65, y_pos+0.15, note, fontsize=7, color='white', style='italic')
    
    if y_pos > 6.2:
        draw_arrow(ax, 5, y_pos, 5, y_pos-0.6, color='#2c3e50', width=2.5)

# SPLIT ARROWS
draw_arrow(ax, 4.2, 6.5, 2.5, 5.2, color=color_endpoint, width=2.5)
ax.text(2.8, 5.8, 'SSE Stream', fontsize=9, color=color_endpoint, 
        fontweight='bold', rotation=30)

draw_arrow(ax, 5.8, 6.5, 7.5, 5.2, color=color_actions, width=2.5)
ax.text(7.2, 5.8, 'Logging', fontsize=9, color=color_actions, 
        fontweight='bold', rotation=-30)

# RESPONSE TO USER
y = 4.2
draw_box(ax, 0.5, y, 3.5, 0.85, 'Response to User', '', 
         color=color_endpoint, textcolor='white')

# SYSTEM ACTIONS BOX
y = 2.2
actions_box = FancyBboxPatch((7, y), 2.8, 2.7, 
                             boxstyle="round,pad=0.1",
                             edgecolor=color_actions, 
                             facecolor='white', 
                             linewidth=2.5,
                             alpha=0.95)
ax.add_patch(actions_box)
ax.text(8.4, y+2.35, 'System Actions', ha='center', va='center', 
        fontsize=11, fontweight='bold', color=color_actions)
ax.plot([7.3, 9.5], [y+2.1, y+2.1], color=color_actions, linewidth=1.5)

actions_text = [
    '• SQLite logging',
    '• Event bus publish',
    '• Cross-circle alerts',
    '• Escalation routing'
]
for i, text in enumerate(actions_text):
    ax.text(7.3, y+1.75-i*0.4, text, ha='left', va='center', 
            fontsize=9, color='#2c3e50')

# LEGEND/COMPARISON BOX
y = 0.2
legend_box = Rectangle((0.3, y), 9.4, 1.6, 
                       facecolor='#ecf0f1', 
                       edgecolor='#95a5a6', 
                       linewidth=1.5,
                       alpha=0.9)
ax.add_patch(legend_box)

ax.text(5, y+1.3, 'Architecture Comparison', ha='center', 
        fontsize=11, fontweight='bold', color='#2c3e50')

# Exp 0
ax.add_patch(Rectangle((0.8, y+0.7), 0.25, 0.25, facecolor=color_llm, 
                       edgecolor='none', alpha=0.9))
ax.text(1.25, y+0.82, 'Exp 0 (Care Circle):', ha='left', va='center', 
        fontsize=9, fontweight='bold', color='#2c3e50')
ax.text(3.5, y+0.82, '3 LLM calls/turn (~1,200 tokens)', ha='left', va='center', 
        fontsize=8, color='#34495e')
ax.text(1.25, y+0.48, '✓ Multi-user  ✓ Privacy guards  ✓ Event-driven', 
        ha='left', va='center', fontsize=8, color='#27ae60')

# Exp 1-7
ax.add_patch(Rectangle((0.8, y+0.1), 0.25, 0.25, facecolor=color_logic, 
                       edgecolor='none', alpha=0.9))
ax.text(1.25, y+0.22, 'Exp 1-7 (Physiology-Aware):', ha='left', va='center', 
        fontsize=9, fontweight='bold', color='#2c3e50')
ax.text(4.2, y+0.22, '1-2 LLM calls/turn (~550-1,200 tokens)', ha='left', va='center', 
        fontsize=8, color='#34495e')
ax.text(7.2, y+0.22, '✗ Single-user  ✗ No privacy', ha='left', va='center', 
        fontsize=8, color='#95a5a6')

plt.tight_layout()
plt.savefig(r'd:\Projects\MMT\Chatbot\Brainwasher 3\figures\care_circle_architecture_flow.png',
            dpi=300, bbox_inches='tight', facecolor='white', edgecolor='none')
print("PNG saved: figures/care_circle_architecture_flow.png")

plt.close()

print("\nImproved diagram generated successfully!")
print("  - Removed HTN terminology")
print("  - Changed 'Side Effects' to 'System Actions'")
print("  - Cleaner design with better colors")
print("  - Uses 'Physiology-Aware Framework' for Exp 1-7")
