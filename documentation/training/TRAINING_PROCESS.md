# training Process Guide

## The Training Cycle Flow

This guide maps the conceptual training flow to the actual technical components and CLI commands.

### 1. Experience Generation (The Baseline)
*   **Concept**: "Generate new or use prior experience"
*   **Goal**: Ensure enough conversation data exists to form a statistically significant baseline (e.g., 50 conversations).
*   **Component**: `ExperienceGenerator`
*   **CLI Command**: `node cli/train.js run` (Automatically checks and runs this).
*   **Log Marker**: 
    *   `[TrainingPipeline] Insufficient data... Generating X baseline simulations...`
    *   `[ExperienceGenerator] Progress: 5/20...`

### 2. Performance Analysis (Feedback)
*   **Concept**: "Feedback"
*   **Goal**: Analyze existing data (scores, user comments, flags) to identify performance bottlenecks.
*   **Component**: `FeedbackAnalyzer`
*   **CLI Command**: Internal step of `run` OR `node cli/train.js analyze-only`.
*   **Log Marker**: 
    *   `[TrainingPipeline] Analyzing current performance...`
    *   `[FeedbackAnalyzer] Performance Analysis: AI Feedback Score: -0.43...`

### 3. Optimization & Prompt Generation (Bandit Creation)
*   **Concept**: "Bandit Creation"
*   **Goal**: Create new "Challenger" prompts designed to fix specific issues found in the analysis.
*   **Component**: `PromptOptimizer`
*   **CLI Command**: Internal step of `run` OR `node cli/train.js force`.
*   **Log Marker**: 
    *   `[TrainingPipeline] Generating optimized prompts...`
    *   `[Optimizer] Generated prompt version: v1.2_empathy_fix`

### 4. Bandit Testing (UCB / Thompson Sampling)
*   **Concept**: "UCB (and experience creation)"
*   **Goal**: Run a competitive A/B test between the **Current Champion** and the **New Challenger**. 
    *   *Note*: This step involves running **NEW** simulations specifically for the test.
*   **Component**: `BanditManager`
*   **CLI Command**: Internal step.
*   **Log Marker**: 
    *   `[BanditManager] Using X diverse scenarios...`
    *   `[BanditManager] Testing version 'v1.2' on scenario...`
    *   *You will see a stream of standard `[Simulator]` logs here as the test runs.*

### 5. Champion Selection
*   **Concept**: "Champion Selection"
*   **Goal**: additional logic to determine if the Challenger beat the Champion.
*   **Component**: `TrainingPipeline`
*   **CLI Command**: Output at end of `run`.
*   **Log Marker**: 
    *   `⚠️ DEPLOYMENT CANDIDATES DETECTED ⚠️`
    *   `📊 No deployment candidates`

## CLI Cheat Sheet
| Goal | Command |
|------|---------|
| **Run Everything** (Standard) | `node cli/train.js run` |
| **Check Progress** | `node cli/train.js status` |
| **Skip Baseline & Force Test** | `node cli/train.js force` |
| **Analyze Data Only** | `node cli/train.js analyze-only` |
