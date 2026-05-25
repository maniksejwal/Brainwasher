from tensornets.a3c.action_bandit import train_and_export
from pathlib import Path

output = Path('tensornets/a3c/bandit_state.json')
output.parent.mkdir(parents=True, exist_ok=True)
bandit, log = train_and_export(n_episodes=100, output_path=str(output), verbose=True)
prior = log['actor_prior']
print('Bandit training complete.')
ep = log.get('total_episodes') or log.get('n_episodes') or len(log.get('rewards', []))
print(f'  Episodes: {ep}')
for bucket, actions in prior.items():
    best = max(actions, key=actions.get)
    score = actions[best]
    print(f'  {bucket}: best={best} ({score:.3f})')
print('Prior saved to: tensornets/a3c/bandit_state_actor_prior.json')
