# Training System

This directory contains the reinforcement learning and training infrastructure.

## 📁 Directory Structure

```
training/
├── core/               # Core logging and metrics
│   ├── logger.js
│   ├── metrics.js
│   └── index.js
├── simulation/         # Synthetic data generation
│   ├── personas.js
│   ├── simulator.js
│   ├── scenario_runner.js
│   └── index.js
├── analysis/          # AI-powered analysis
│   ├── feedback_analyzer.js
│   ├── prompt_optimizer.js
│   ├── ab_test.js
│   └── index.js
├── feedback/          # Human feedback collection
│   ├── annotator.js
│   └── index.js
├── config/            # Centralized configuration
│   └── analysis_prompts.js
└── index.js           # Main exports
```

## 📚 Documentation

See comprehensive documentation in `documentation/training/`:

- **[Getting Started](../documentation/training/GETTING_STARTED.md)** - Quick start guide
- **[Architecture](../documentation/training/ARCHITECTURE.md)** - System diagrams
- **[Implementation Summary](../documentation/training/IMPLEMENTATION_SUMMARY.md)** - What was built

## 🚀 Quick Usage

```javascript
// Import from main entry point
import { logger, metrics, SimulationDriver, FeedbackAnalyzer } from './training/index.js';

// Or from sub-packages
import { logger } from './training/core/index.js';
import { SimulationDriver } from './training/simulation/index.js';
```

## 🛠️ CLI Tools

```bash
# Run simulation
node training/simulation/simulator.js

# Analyze feedback
node training/analysis/feedback_analyzer.js

# Optimize prompts
node training/analysis/prompt_optimizer.js

# A/B test
node training/analysis/ab_test.js --baseline v1.0 --challenger v1.1

# Annotate conversations
node training/feedback/annotator.js
```

## 📊 Generated Files

The following files are auto-generated (add to `.gitignore`):
- `training_log.jsonl` - Conversation logs
- `metrics.jsonl` - Performance metrics
- `analysis_report.md` - Analysis output
- `ab_test_*.md` - A/B test reports

## ⚙️ Configuration

Edit `config/analysis_prompts.js` to customize:
- AI analysis prompts
- Optimization templates
- Command usage text

For more details, see the [full documentation](../documentation/training/).

