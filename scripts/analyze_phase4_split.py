import pandas as pd

# Read the CSV
df = pd.read_csv('phd/training_runs_summary.csv')

# Filter for runs 138-148
last_runs = df[df['run_number'].between(138, 148)].copy()

print("=" * 80)
print("RUNS 138-148 ANALYSIS")
print("=" * 80)
print(f"\nTotal runs: {len(last_runs)}")
print(f"\nGoal achievement rates:")
print(last_runs[['run_number', 'total_episodes', 'goal_pct', 'category']].to_string(index=False))

print(f"\n\nStatistics:")
print(f"  - Episodes range: {last_runs['total_episodes'].min()}-{last_runs['total_episodes'].max()}")
print(f"  - Goal rate range: {last_runs['goal_pct'].min():.1f}%-{last_runs['goal_pct'].max():.1f}%")
print(f"  - Mean goal rate: {last_runs['goal_pct'].mean():.1f}%")
print(f"  - Median goal rate: {last_runs['goal_pct'].median():.1f}%")

print(f"\n\nGoal rates >= 90%: {(last_runs['goal_pct'] >= 90).sum()} out of {len(last_runs)}")
print(f"Goal rates >= 95%: {(last_runs['goal_pct'] >= 95).sum()} out of {len(last_runs)}")

print("\n" + "=" * 80)
print("RUNS 91-137 ANALYSIS (for comparison)")
print("=" * 80)

phase4_runs = df[df['run_number'].between(91, 137)].copy()
print(f"\nTotal runs: {len(phase4_runs)}")
print(f"\n\nStatistics:")
print(f"  - Episodes range: {phase4_runs['total_episodes'].min()}-{phase4_runs['total_episodes'].max()}")
print(f"  - Goal rate range: {phase4_runs['goal_pct'].min():.1f}%-{phase4_runs['goal_pct'].max():.1f}%")
print(f"  - Mean goal rate: {phase4_runs['goal_pct'].mean():.1f}%")
print(f"  - Median goal rate: {phase4_runs['goal_pct'].median():.1f}%")

print(f"\n\nGoal rates >= 90%: {(phase4_runs['goal_pct'] >= 90).sum()} out of {len(phase4_runs)}")
print(f"Goal rates >= 95%: {(phase4_runs['goal_pct'] >= 95).sum()} out of {len(phase4_runs)}")

# Key runs mentioned in table
print("\n" + "=" * 80)
print("KEY RUNS FROM TABLE")
print("=" * 80)
key_runs = [103, 109, 124, 131]
for run_num in key_runs:
    run_data = df[df['run_number'] == run_num]
    if not run_data.empty:
        print(f"Run {run_num}: {run_data['total_episodes'].values[0]} episodes, {run_data['goal_pct'].values[0]:.1f}% goal rate")
