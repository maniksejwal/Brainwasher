#!/usr/bin/env python3
"""
Regenerate thesis figures based on user feedback:
1. Individual episode history curves (not overlapping) with moving averages
2. Use experiment names + numbers
3. Generate LaTeX table for rankings (not figure)
4. All experiments are preliminary (no "comprehensive" distinction)
5. Remove MPS from names, use "Episode History" instead of "Learning"
6. Place 0 at origin, remove "Episode Index" text
7. MA -> "Moving average" in legend
8. Vertical line -> "Episode goal achieved"
"""

import sqlite3
import matplotlib.pyplot as plt
import matplotlib as mpl
import numpy as np
from pathlib import Path

# Publication settings
mpl.rcParams['font.family'] = 'serif'
mpl.rcParams['font.size'] = 10
mpl.rcParams['axes.linewidth'] = 0.8
mpl.rcParams['figure.dpi'] = 300

DB_PATH = "data/dbs/care_circle_dev.db"
OUT_DIR = Path("phd/figures")
OUT_DIR.mkdir(exist_ok=True)

# Experiment configurations with full names (removed MPS references)
BASE_ARMS = [
    ('oldschool', 'Exp 0: Baseline'),
    ('physio_llm', 'Exp 1: Physio+LLM'),
    ('physio_llm_cot_mcts', 'Exp 2: Physio+LLM+CoT+MCTS'),
    ('physio_mps_mcts', 'Exp 3: Physio+MCTS'),
    ('inertial_physio_mps_mcts', 'Exp 4: Inertial+Physio+MCTS'),
    ('inertial_physio_llm_cot_mcts', 'Exp 5: Inertial+Physio+LLM+CoT+MCTS'),
    ('inertial_hpvoot_physio_mps_mcts', 'Exp 6: Inertial+HPVOOT+Physio+MCTS'),
    ('inertial_hpvoot_physio_llm_cot_mcts', 'Exp 7: Inertial+HPVOOT+Physio+LLM+CoT+MCTS'),
]

DPO_ARMS = [
    ('oldschool_dpo', 'Exp 0p: Baseline+Context'),
    ('physio_llm_dpo', 'Exp 1p: Physio+LLM+Context'),
    ('physio_llm_cot_mcts_dpo', 'Exp 2p: Physio+LLM+CoT+MCTS+Context'),
    ('physio_mps_mcts_dpo', 'Exp 3p: Physio+MCTS+Context'),
    ('inertial_physio_mps_mcts_dpo', 'Exp 4p: Inertial+Physio+MCTS+Context'),
    ('inertial_physio_llm_cot_mcts_dpo', 'Exp 5p: Inertial+Physio+LLM+CoT+MCTS+Context'),
    ('inertial_hpvoot_physio_mps_mcts_dpo', 'Exp 6p: Inertial+HPVOOT+Physio+MCTS+Context'),
    ('inertial_hpvoot_physio_llm_cot_mcts_dpo', 'Exp 7p: Inertial+HPVOOT+Physio+LLM+CoT+MCTS+Context'),
]


def get_db():
    return sqlite3.connect(DB_PATH)


def moving_average(values, window=50):
    """Compute simple moving average."""
    if len(values) < window:
        return values
    result = []
    for i in range(len(values)):
        start = max(0, i - window + 1)
        slice_vals = values[start:i+1]
        result.append(np.mean(slice_vals))
    return np.array(result)


def plot_individual_learning_curves():
    """Generate separate episode history curve for each experiment with moving average."""
    print("\nGenerating individual episode history curves...")
    
    db = get_db()
    all_arms = BASE_ARMS + DPO_ARMS
    
    for arm_name, label in all_arms:
        rows = db.execute("""
            SELECT goal_achieved, completed_at
            FROM htn_benchmark_episodes
            WHERE arm = ? AND completed_at IS NOT NULL
            ORDER BY completed_at ASC
        """, (arm_name,)).fetchall()
        
        if not rows or len(rows) < 20:
            print(f"  [SKIP] {label} - insufficient data ({len(rows) if rows else 0} episodes)")
            continue
        
        goal_achieved = np.array([r[0] for r in rows])
        
        # Compute 50-episode moving average
        ma = moving_average(goal_achieved, window=50)
        
        # Create figure
        fig, ax = plt.subplots(figsize=(8, 4))
        
        # Episode numbers (1-indexed)
        episodes = np.arange(1, len(goal_achieved) + 1)
        
        # Raw data (light, transparent)
        ax.plot(episodes, goal_achieved * 100, 
                alpha=0.2, color='steelblue', linewidth=0.5, label='Episode goal achieved')
        
        # Moving average (bold)
        ax.plot(episodes, ma * 100, 
                color='darkblue', linewidth=2, label='Moving average (50 episodes)')
        
        # Set origin at 0
        ax.set_xlim(left=0)
        ax.set_ylim(bottom=0, top=100)
        
        ax.set_xlabel('Episode', fontsize=11)
        ax.set_ylabel('Goal Achievement Rate (%)', fontsize=11)
        ax.set_title(f'Episode History: {label}', fontsize=12, fontweight='bold')
        ax.legend(loc='best', fontsize=9)
        ax.grid(True, alpha=0.3, linestyle='--')
        
        plt.tight_layout()
        
        # Save with sanitized filename
        safe_name = arm_name.replace('_', '-')
        plt.savefig(OUT_DIR / f'learning_{safe_name}.pdf', bbox_inches='tight')
        plt.savefig(OUT_DIR / f'learning_{safe_name}.png', bbox_inches='tight', dpi=300)
        plt.close()
        
        print(f"  [OK] {label}")
    
    db.close()


def plot_dpo_comparison():
    """Bar chart comparing base vs Context-enriched on last 100 episodes."""
    print("\nGenerating Context enrichment comparison chart...")
    
    db = get_db()
    fig, ax = plt.subplots(figsize=(10, 6))
    
    labels = []
    base_vals = []
    dpo_vals = []
    
    for i, ((base_arm, base_label), (dpo_arm, dpo_label)) in enumerate(zip(BASE_ARMS, DPO_ARMS)):
        base_rows = db.execute("""
            SELECT AVG(goal_achieved) * 100
            FROM (
                SELECT goal_achieved FROM htn_benchmark_episodes
                WHERE arm = ? AND completed_at IS NOT NULL
                ORDER BY completed_at DESC LIMIT 100
            )
        """, (base_arm,)).fetchone()
        
        dpo_rows = db.execute("""
            SELECT AVG(goal_achieved) * 100
            FROM (
                SELECT goal_achieved FROM htn_benchmark_episodes
                WHERE arm = ? AND completed_at IS NOT NULL
                ORDER BY completed_at DESC LIMIT 100
            )
        """, (dpo_arm,)).fetchone()
        
        labels.append(f'Exp {i}')
        base_vals.append(base_rows[0] if base_rows[0] else 0)
        dpo_vals.append(dpo_rows[0] if dpo_rows[0] else 0)
    
    x = np.arange(len(labels))
    width = 0.35
    
    ax.bar(x - width/2, base_vals, width, label='Baseline', color='steelblue', alpha=0.8)
    ax.bar(x + width/2, dpo_vals, width, label='Context-enriched', color='coral', alpha=0.8, hatch='//')
    
    ax.set_xlabel('Experiment', fontsize=11)
    ax.set_ylabel('Goal Achievement Rate (%)', fontsize=11)
    ax.set_title('Baseline vs Context-Enriched Performance (Last 100 Episodes)', fontsize=12, fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.legend(fontsize=10)
    ax.grid(True, axis='y', alpha=0.3, linestyle='--')
    ax.set_ylim(bottom=0, top=16)
    
    plt.tight_layout()
    plt.savefig(OUT_DIR / 'dpo_comparison.pdf', bbox_inches='tight')
    plt.savefig(OUT_DIR / 'dpo_comparison.png', bbox_inches='tight', dpi=300)
    plt.close()
    
    db.close()
    print("  [OK] Context enrichment comparison chart")


def generate_rankings_latex_table():
    """Generate LaTeX table code for 32-experiment rankings."""
    print("\nGenerating LaTeX table for rankings...")
    
    db = get_db()
    all_arms = BASE_ARMS + DPO_ARMS
    data = []
    
    for arm_name, label in all_arms:
        row = db.execute("""
            SELECT 
                COUNT(*) as total_eps,
                ROUND(AVG(goal_achieved) * 100, 1) as goal_pct,
                ROUND(AVG(cumulative_reward), 2) as avg_reward,
                ROUND(AVG(turn_count), 1) as avg_turns
            FROM (
                SELECT * FROM htn_benchmark_episodes
                WHERE arm = ? AND completed_at IS NOT NULL
                ORDER BY completed_at DESC LIMIT 100
            )
        """, (arm_name,)).fetchone()
        
        if row and row[0] > 0:
            data.append({
                'label': label,
                'goal_pct': row[1],
                'avg_reward': row[2],
                'avg_turns': row[3],
                'total_eps': row[0]
            })
    
    # Sort by goal achievement
    data.sort(key=lambda x: x['goal_pct'], reverse=True)
    
    # Generate LaTeX
    latex = r"""\begin{table}[ht]
\centering
\caption{Performance rankings for all 16 experiments (preliminary results, last 100 episodes). All experiments are ongoing; those starting later (context-enriched variants) have fewer total episodes but comparable evaluation windows.}
\label{tab:32exp_rankings}
\begin{tabular}{lrrrr}
\toprule
\textbf{Experiment} & \textbf{Goal \%} & \textbf{Avg Reward} & \textbf{Avg Turns} & \textbf{Total Eps} \\
\midrule
"""
    
    for i, row in enumerate(data):
        # Highlight top 3
        if i < 3:
            latex += r"\rowcolor{yellow!20} "
        latex += f"{row['label']} & {row['goal_pct']:.1f} & {row['avg_reward']:.2f} & {row['avg_turns']:.1f} & {row['total_eps']} \\\\\n"
    
    latex += r"""\bottomrule
\end{tabular}
\end{table}
"""
    
    # Write to file
    with open(OUT_DIR / 'table_rankings.tex', 'w') as f:
        f.write(latex)
    
    db.close()
    print(f"  [OK] LaTeX table saved to {OUT_DIR / 'table_rankings.tex'}")


if __name__ == '__main__':
    print("\n" + "="*60)
    print("  Generating Thesis Figures (Revised - Episode Histories)")
    print("="*60)
    
    plot_individual_learning_curves()
    plot_dpo_comparison()
    generate_rankings_latex_table()
    
    print("\n" + "="*60)
    print("  [SUCCESS] All figures and tables generated!")
    print("="*60)
    print(f"\nFiles saved to: {OUT_DIR.absolute()}")
    print("\nNote: Individual episode history curves generated separately.")
    print("      Rankings table saved as LaTeX code (not figure).")
    print()
