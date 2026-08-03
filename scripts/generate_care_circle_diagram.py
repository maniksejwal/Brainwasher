"""
Generate improved Care Circle architecture diagram as PNG
"""
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle
import matplotlib.lines as mlines

fig, ax = plt.subplots(figsize=(12, 16))
ax.set_xlim(0, 12)
ax.set_ylim(0, 18)
ax.axis('off')

# Professional color scheme
color_endpoint = '#2E86AB'      # Blue - endpoints
color_router = '#A23B72'        # Purple - coordinator
color_llm = '#F18F01'           # Orange - LLM calls
color_logic = '#C73E1D'         # Red - logic/action
color_guard = '#6A994E'         # Green - security
color_effects = '#495057'       # Gray - side effects

def draw_box(ax, x, y, width, height, text, subtitle='', color='white', 
             textcolor='black', border_width=2, border_color='black'):
    """Draw a rounded rectangle box with text"""
    box = FancyBboxPatch((x, y), width, height, 
                         boxstyle="round,pad=0.08", 
                         edgecolor=border_color, 
                         facecolor=color, 
                         linewidth=border_width)
    ax.add_patch(box)
    
    if subtitle:
        ax.text(x + width/2, y + height*0.65, text, 
                ha='center', va='center', 
                fontsize=11, fontweight='bold', color=textcolor)
        ax.text(x + width/2, y + height*0.3, subtitle, 
                ha='center', va='center', 
                fontsize=9, color=textcolor, style='italic')
    else:
        ax.text(x + width/2, y + height/2, text, 
                ha='center', va='center', 
                fontsize=11, fontweight='bold', color=textcolor)

def draw_arrow(ax, x1, y1, x2, y2, color='black', width=2, style='-'):
    """Draw arrow between boxes"""
    arrow = FancyArrowPatch((x1, y1), (x2, y2),
                           arrowstyle='->', 
                           color=color, 
                           linewidth=width,
                           linestyle=style,
                           mutation_scale=20)
    ax.add_patch(arrow)

# Title
ax.text(6, 17.3, 'Care Circle: Multi-Agent Architecture', 
        ha='center', fontsize=18, fontweight='bold')
ax.text(6, 16.8, 'Experiment 0 (JavaScript Implementation)', 
        ha='center', fontsize=11, style='italic', color='#666')

# ===== USER =====
y = 15.8
draw_box(ax, 4, y, 4, 0.8, 'User Message', '', 
         color=color_endpoint, textcolor='white', border_color=color_endpoint)

draw_arrow(ax, 6, y, 6, y-0.5, color='#333', width=2.5)

# ===== COORDINATOR =====
y = 14.5
draw_box(ax, 3.5, y, 5, 0.9, 'CompanionCoordinator', 'Message Router', 
         color=color_router, textcolor='white', border_color=color_router)

draw_arrow(ax, 6, y, 6, y-0.5, color='#333', width=2.5)

# ===== PIPELINE STAGE 1: Intent Handler =====
y = 13
draw_box(ax, 2.5, y, 7, 1.0, '① Intent Handler', 'LLM Call #1 · Command Detection', 
         color=color_llm, textcolor='white', border_color=color_llm, border_width=3)
ax.text(2.7, y+0.15, '~400 tokens', fontsize=8, color='white', style='italic')

draw_arrow(ax, 6, y, 6, y-0.5, color='#333', width=2.5)

# ===== PIPELINE STAGE 2: Privacy Guard =====
y = 11.4
draw_box(ax, 2.5, y, 7, 1.0, '② Privacy Guard', 'Consent Tier Enforcement', 
         color=color_guard, textcolor='white', border_color=color_guard, border_width=3)
ax.text(2.7, y+0.15, 'Filter', fontsize=8, color='white', style='italic')

draw_arrow(ax, 6, y, 6, y-0.5, color='#333', width=2.5)

# ===== PIPELINE STAGE 3: AI Analysis =====
y = 9.8
draw_box(ax, 2.5, y, 7, 1.0, '③ AI Analysis', 'LLM Call #2 · Sentiment + Criticality', 
         color=color_llm, textcolor='white', border_color=color_llm, border_width=3)
ax.text(2.7, y+0.15, '~350 tokens', fontsize=8, color='white', style='italic')

draw_arrow(ax, 6, y, 6, y-0.5, color='#333', width=2.5)

# ===== PIPELINE STAGE 4: Action Executor =====
y = 8.2
draw_box(ax, 2.5, y, 7, 1.0, '④ Action Executor', 'Policy Selection (A3C)', 
         color=color_logic, textcolor='white', border_color=color_logic, border_width=3)
ax.text(2.7, y+0.15, 'Tabular softmax', fontsize=8, color='white', style='italic')

draw_arrow(ax, 6, y, 6, y-0.5, color='#333', width=2.5)

# ===== PIPELINE STAGE 5: Response Generator =====
y = 6.6
draw_box(ax, 2.5, y, 7, 1.0, '⑤ Response Generator', 'LLM Call #3 · Generate Reply', 
         color=color_llm, textcolor='white', border_color=color_llm, border_width=3)
ax.text(2.7, y+0.15, '~450 tokens', fontsize=8, color='white', style='italic')

# ===== SPLIT: Response to User + Side Effects =====
# Arrow to user
draw_arrow(ax, 4, 6.9, 2.5, 5.2, color='#2E86AB', width=2.5)
ax.text(2.8, 6, 'SSE Stream', fontsize=9, color='#2E86AB', fontweight='bold', rotation=35)

# Arrow to side effects
draw_arrow(ax, 8, 6.9, 9.5, 5.2, color='#495057', width=2.5)
ax.text(9.2, 6, 'Logging', fontsize=9, color='#495057', fontweight='bold', rotation=-35)

# ===== RESPONSE TO USER =====
y = 4.2
draw_box(ax, 0.5, y, 3.5, 0.9, 'Response to User', '', 
         color=color_endpoint, textcolor='white', border_color=color_endpoint)

# ===== SIDE EFFECTS =====
y = 2.5
effects_box = FancyBboxPatch((8, y), 3.5, 2.5, 
                             boxstyle="round,pad=0.08",
                             edgecolor=color_effects, 
                             facecolor='white', 
                             linewidth=2.5)
ax.add_patch(effects_box)
ax.text(9.75, y+2.15, 'Side Effects', ha='center', va='center', 
        fontsize=11, fontweight='bold', color=color_effects)
ax.plot([8.3, 11.2], [y+1.95, y+1.95], color=color_effects, linewidth=1.5)

effects_text = [
    '• SQLite logging',
    '• Event bus publish',
    '• Cross-circle alerts',
    '• Doctor escalation'
]
for i, text in enumerate(effects_text):
    ax.text(8.3, y+1.6-i*0.35, text, ha='left', va='center', 
            fontsize=9, color='#333')

# ===== LEGEND BOX =====
y = 0.3
legend_box = Rectangle((0.5, y), 11, 1.5, 
                       facecolor='#f8f9fa', 
                       edgecolor='#dee2e6', 
                       linewidth=1.5)
ax.add_patch(legend_box)

ax.text(6, y+1.2, 'Architecture Comparison', ha='center', 
        fontsize=11, fontweight='bold', color='#333')

# Exp 0
ax.add_patch(Rectangle((1, y+0.65), 0.3, 0.3, facecolor=color_llm, edgecolor='none'))
ax.text(1.5, y+0.8, 'Exp 0 (Care Circle):', ha='left', va='center', 
        fontsize=9, fontweight='bold', color='#333')
ax.text(4, y+0.8, '3 LLM calls/turn (~1,200 tokens)', ha='left', va='center', 
        fontsize=8, color='#555')
ax.text(1.5, y+0.45, '✓ Multi-user  ✓ Privacy guards  ✓ Event-driven', ha='left', va='center', 
        fontsize=8, color='#555')

# Exp 1-7
ax.add_patch(Rectangle((1, y+0.05), 0.3, 0.3, facecolor=color_logic, edgecolor='none'))
ax.text(1.5, y+0.2, 'Exp 1-7 (HTN):', ha='left', va='center', 
        fontsize=9, fontweight='bold', color='#333')
ax.text(4, y+0.2, '1-2 LLM calls/turn (~550-1,200 tokens)', ha='left', va='center', 
        fontsize=8, color='#555')
ax.text(7, y+0.2, '✗ Single-user  ✗ No privacy layer', ha='left', va='center', 
        fontsize=8, color='#999')

plt.tight_layout()
plt.savefig(r'd:\Projects\MMT\Chatbot\Brainwasher 3\figures\care_circle_architecture_flow.png',
            dpi=300, bbox_inches='tight', facecolor='white', edgecolor='none')
print("PNG saved: figures/care_circle_architecture_flow.png")
plt.close()

print("\nImproved diagram generated successfully!")
print("  - Professional color scheme")
print("  - Cleaner typography")
print("  - Better spacing and hierarchy")
print("  - Clear LLM call indicators")
