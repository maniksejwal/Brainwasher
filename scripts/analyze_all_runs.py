"""
Analyze all training runs from database for thesis documentation
"""
import sqlite3
import pandas as pd
from datetime import datetime

DB = r"d:\Projects\MMT\Chatbot\Brainwasher 3\data\dbs\care_circle_dev.db"

con = sqlite3.connect(DB)

# Get run-level summary
run_summary = pd.read_sql_query("""
    SELECT 
        run_id,
        COUNT(DISTINCT arm) as num_arms,
        COUNT(*) as total_episodes,
        MIN(started_at) as first_episode,
        MAX(completed_at) as last_episode,
        ROUND(100.0 * SUM(CASE WHEN goal_achieved=1 THEN 1 ELSE 0 END) / COUNT(*), 1) as goal_pct,
        GROUP_CONCAT(DISTINCT arm) as arms_list
    FROM htn_benchmark_episodes
    WHERE completed_at IS NOT NULL
    GROUP BY run_id
    ORDER BY datetime(first_episode)
""", con)

print(f"="*80)
print(f"TOTAL TRAINING RUNS: {len(run_summary)}")
print(f"="*80)

# Convert timestamps
run_summary['first_date'] = pd.to_datetime(run_summary['first_episode']).dt.date
run_summary['last_date'] = pd.to_datetime(run_summary['last_episode']).dt.date

# Categorize runs
run_summary['category'] = pd.cut(run_summary['total_episodes'], 
                                  bins=[0, 10, 50, 100, 500, 10000],
                                  labels=['Debug (<10ep)', 'Small (11-50ep)', 'Medium (51-100ep)', 
                                          'Large (101-500ep)', 'Production (500+ep)'])

print(f"\nRuns by category:")
print(run_summary['category'].value_counts().sort_index())

# Identify main thesis run
main_run = run_summary.loc[run_summary['total_episodes'].idxmax()]
print(f"\n{'='*80}")
print(f"MAIN THESIS RUN (highest episode count)")
print(f"{'='*80}")
print(f"Run ID: {main_run['run_id'][:8]}...")
print(f"Arms: {main_run['num_arms']}")
print(f"Episodes: {main_run['total_episodes']}")
print(f"Goal Rate: {main_run['goal_pct']}%")
print(f"Period: {main_run['first_date']} to {main_run['last_date']}")

# Show production runs (500+ episodes)
production_runs = run_summary[run_summary['total_episodes'] > 500].sort_values('first_date')
print(f"\n{'='*80}")
print(f"PRODUCTION RUNS (500+ episodes): {len(production_runs)}")
print(f"={'='*80}")
for idx, row in production_runs.iterrows():
    print(f"Run {row.name+1}: {row['num_arms']} arms, {row['total_episodes']} episodes, "
          f"goal={row['goal_pct']}%, {row['first_date']} to {row['last_date']}")

# Show first 10 runs (debugging phase)
print(f"\n{'='*80}")
print(f"FIRST 10 RUNS (early debugging)")
print(f"{'='*80}")
for idx, row in run_summary.head(10).iterrows():
    print(f"Run {idx+1}: {row['num_arms']:2d} arms, {row['total_episodes']:4d} episodes, "
          f"goal={row['goal_pct']:4.1f}%, {row['first_date']}")

# Show last 10 runs
print(f"\n{'='*80}")
print(f"LAST 10 RUNS (recent)")
print(f"{'='*80}")
for idx, row in run_summary.tail(10).iterrows():
    print(f"Run {idx+1}: {row['num_arms']:2d} arms, {row['total_episodes']:4d} episodes, "
          f"goal={row['goal_pct']:4.1f}%, {row['first_date']}")

# Save full run history for appendix
run_summary[['run_id', 'num_arms', 'total_episodes', 'goal_pct', 'first_date', 'last_date', 'category']].to_csv(
    r"d:\Projects\MMT\Chatbot\Brainwasher 3\phd\training_runs_summary.csv",
    index_label='run_number'
)

print(f"\n{'='*80}")
print(f"Full run history saved to: phd/training_runs_summary.csv")
print(f"{'='*80}")

con.close()
