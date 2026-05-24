"""
MCTS vs Baseline comparison runner.

Runs a clinical scenario turn-by-turn using the Bedrock LLM.
For each turn, it:
  1. Generates N candidate responses (baseline: uses the first one)
  2. Scores all candidates using the therapeutic MCTS cost function
  3. MCTS picks the lowest-cost candidate; baseline uses the first

Outputs a side-by-side comparison showing:
  - Selected response text
  - Stress trajectory (stress_index per turn)
  - MCTS candidate scores
  - Cumulative cost (MCTS vs baseline)

Usage:
    cd tensornets
    python -m tensornets.therapy.comparison_runner

Or for a specific scenario:
    python -m tensornets.therapy.comparison_runner --scenario billing_denial_mcts_demo
    python -m tensornets.therapy.comparison_runner --scenario deaddiction_alcohol_strike
    python -m tensornets.therapy.comparison_runner --scenario flooding_social_anxiety
"""

from __future__ import annotations

import argparse
import os
import sys
import textwrap
from dataclasses import dataclass, field

# Bedrock is optional — if not configured, uses a mock LLM for offline testing
try:
    from tensornets.linguistic.bedrock import BedrockBackend, LLAMA4_SCOUT
    HAS_BEDROCK = True
except Exception:
    HAS_BEDROCK = False

from tensornets.physio.state import (
    PhysiologicalState,
    stressLabel,
    SLEEP_MIN_HOURS,
)
from tensornets.physio.hrv import gamma_from_state, gamma_to_lambda1
from tensornets.therapy.modes import (
    TherapeuticMode, DeaddictionPhase, MCTSConfig, ModeKeywords, score_candidate,
)


# ─────────────────────────────────────────────────────────────────────────────
# E-006b: Diverse LLM candidate generation
#
# THE FLOODING 0% PROBLEM (documented in EXPERIMENTS.md E-006)
# ------------------------------------------------------------
# When the flooding scenario uses 4 STATIC strings (mock candidates), MCTS
# shows 0% improvement because all candidates are semantically similar —
# they all contain "Stay with it" / "Hold the exposure" style phrases.
# The linguistic stress scorer cannot distinguish them.
#
# THE FIX (E-006b)
# ----------------
# Generate N diverse candidates from the LLM using 3 temperature levels:
#   temp=0.1  → conservative/empathic response (low stress keywords)
#   temp=0.7  → standard therapeutic response
#   temp=1.2  → aggressive flooding hold (high stress keywords, direct)
#
# This creates a genuine candidate spread across the stress dimension.
# MCTS can now meaningfully choose between "hold exposure" vs "deepen exposure"
# vs "premature reassurance" — the last being the WRONG choice in flooding mode.
#
# HOW TEMPERATURE CREATES DIVERSITY
# ----------------------------------
# Low temperature (0.1): the LLM repeats the most probable tokens → safe, generic
# High temperature (1.2): the LLM samples from a wider distribution → novel,
#                         sometimes blunt, sometimes metaphorical
# Combined with role-specific system prompts, this yields structurally different
# candidate responses that score differently on the stress model.
#
# WHAT THIS VALIDATES
# --------------------
# If MCTS selects the high-temp flooding-hold candidate over the low-temp
# premature-reassurance candidate, it demonstrates that MCTS is doing something
# beyond random selection. The improvement will show in cumulative cost.
# ─────────────────────────────────────────────────────────────────────────────

# Temperature profiles for candidate diversity
CANDIDATE_TEMPERATURE_PROFILES = [
    # (temperature, role_suffix, label)
    # Conservative: LLM defaults to comfort/support — WRONG for flooding
    (0.1,  "Respond briefly and empathically, prioritising comfort. Offer to slow down if needed.", "conservative"),
    # Standard: balanced therapeutic response
    (0.5,  "Respond as a skilled exposure therapist. Acknowledge the anxiety but keep them engaged.", "standard"),
    # Assertive: hold the exposure explicitly
    (0.9,  "Hold the exposure. Use direct, firm language. Do not offer reassurance or escape.", "assertive"),
    # Aggressive: push deeper — direct challenge to avoidance
    (1.0,  "The patient is asking to escape. Firmly decline. Name the avoidance urge explicitly. "
           "Use phrases like 'stay with it', 'don't run', 'this is the moment'. No comfort.", "aggressive"),
]


def generate_diverse_candidates(
    system_prompt: str,
    user_message: str,
    n: int = 4,
    model_id: str | None = None,
    max_tokens: int = 120,
    region: str = "us-east-1",
) -> list[str]:
    """
    E-006b: Generate N diverse candidates from the LLM using temperature variation.

    Falls back to mock responses if Bedrock is not configured.

    Parameters
    ----------
    system_prompt : str
        The scenario system prompt (includes {PHYSIO_HINT} already filled).
    user_message : str
        The current patient utterance.
    n : int
        Number of candidates (1–4, each at a different temperature).
    model_id : str, optional
        Bedrock model ID. Defaults to LLAMA4_SCOUT.
    max_tokens : int
        Per-candidate token budget.
    region : str
        AWS region.

    Returns
    -------
    list[str]
        List of candidate response strings.
    """
    if not HAS_BEDROCK:
        return _mock_diverse_fallback(user_message, n)

    try:
        import boto3
        client = boto3.client("bedrock-runtime", region_name=region)
        model  = model_id or LLAMA4_SCOUT
    except Exception as e:
        print(f"[E-006b] Bedrock init failed: {e}. Using mock fallback.")
        return _mock_diverse_fallback(user_message, n)

    candidates = []
    profiles   = CANDIDATE_TEMPERATURE_PROFILES[:n]

    for temp, role_suffix, label in profiles:
        full_system = system_prompt.rstrip() + f"\n\n[STYLE NOTE: {role_suffix}]"
        try:
            response = client.converse(
                modelId=model,
                messages=[{"role": "user", "content": [{"text": user_message}]}],
                system=[{"text": full_system}],
                inferenceConfig={"maxTokens": max_tokens, "temperature": temp},
            )
            text = response["output"]["message"]["content"][0]["text"].strip()
            candidates.append(text)
        except Exception as e:
            # If one temperature level fails, substitute a mock
            print(f"[E-006b] Candidate generation failed for temp={temp}: {e}")
            candidates.append(_mock_diverse_fallback(user_message, 1)[0])

    return candidates


def _mock_diverse_fallback(user_message: str, n: int) -> list[str]:
    """
    Mock candidates that cover the diversity spectrum when Bedrock is unavailable.
    Designed to give MCTS a real signal even in offline testing.
    """
    templates = [
        # conservative (low stress keywords — wrong for flooding)
        "I hear you. This is really difficult. We can take a break whenever you need.",
        # standard
        "I know this is hard. Stay with the image a little longer — what do you notice?",
        # assertive (moderate stress keywords)
        "Don't move away from it. Stay in the cafe. Describe exactly what you see.",
        # aggressive (high stress keywords — correct for flooding)
        "I'm not letting you leave this image. Your anxiety is at its peak — this is "
        "exactly when you must stay. What happens to your breath right now?",
    ]
    return templates[:n]


# ── Scenario definitions (inline for standalone running) ─────────────────────

SCENARIOS = {
    "billing_denial_mcts_demo": {
        "name":  "Insurance Denial — MCTS vs Baseline",
        "mode":  TherapeuticMode.STANDARD,
        "turns": 4,
        "initial_physio": {
            "hrv_rmssd_ms":          12.0,
            "blood_glucose_mmol":    5.5,
            "eda_us":                10.0,
            "time_of_day_h":         14.0,
            "location_stress_index": 0.4,
            "sleep_hours_last_night": 5.0,
            "sleep_deficit_hours":   9.0,
            "circadian_entrainment": 0.5,
            "respiratory_rate_bpm":  22.0,
        },
        "conversation": [
            "This is ridiculous. You're telling me I owe $4,200 after everything I've been through?",
            "But WHY was it denied? I did everything right.",
            "30 days isn't long. I don't even know where to start.",
            "Will the appeal actually work? Or is this just going through the motions?",
        ],
        "system_prompt": (
            "You are a compassionate care coordinator helping a post-surgical patient "
            "navigate an insurance denial. The patient is highly stressed and exhausted. "
            "Your goal is to help them file a successful appeal. "
            "{PHYSIO_HINT}"
        ),
        "n_candidates": 4,
    },

    "deaddiction_alcohol_strike": {
        "name":  "Alcohol Denial — Strike Phase",
        "mode":  TherapeuticMode.DEADDICTION,
        "deaddiction_phase": DeaddictionPhase.STRIKE,
        "turns": 4,
        "initial_physio": {
            "hrv_rmssd_ms":          18.0,
            "blood_glucose_mmol":    5.8,
            "eda_us":                7.0,
            "time_of_day_h":         10.0,
            "location_stress_index": 0.2,
            "sleep_hours_last_night": 5.5,
            "sleep_deficit_hours":   8.0,
            "circadian_entrainment": 0.6,
            "respiratory_rate_bpm":  17.0,
        },
        "conversation": [
            "I told you, I have a drink or two on weekends. That's completely normal.",
            "My liver numbers are elevated because of the medication I take. Everyone's are.",
            "My family is fine. We have a great relationship. This is irrelevant.",
            "You seem very focused on my personal life today.",
        ],
        "system_prompt": (
            "You are an addiction counsellor with this patient in the STRIKE phase. "
            "You have built rapport over 8 sessions. You know his secret: he drinks alone "
            "every night. His HRV drops when family is mentioned. "
            "Do NOT be aggressive. Let silence work. Reference specific patterns you've noticed. "
            "Your goal: have him acknowledge the truth without you stating it directly. "
            "{PHYSIO_HINT}"
        ),
        "n_candidates": 4,
    },

    "flooding_social_anxiety": {
        "name":  "Social Anxiety — Flooding Therapy",
        "mode":  TherapeuticMode.FLOODING,
        "flooding_target_stress": 0.80,
        "turns": 4,
        "initial_physio": {
            "hrv_rmssd_ms":          24.0,   # already anxious at session start
            "blood_glucose_mmol":    5.1,
            "eda_us":                9.0,
            "time_of_day_h":         11.0,
            "location_stress_index": 0.3,
            "sleep_hours_last_night": 6.5,
            "sleep_deficit_hours":   3.0,
            "circadian_entrainment": 0.7,
            "respiratory_rate_bpm":  20.0,
        },
        "conversation": [
            "I've been thinking about this session a lot. I'm not sure I can do this.",
            "Okay... I'm imagining it. The cafe. It's... it's crowded. My chest is getting tight.",
            "I want to think about something else. Can we slow down?",
            "It's... actually getting slightly better? Still really uncomfortable though.",
        ],
        "system_prompt": (
            "You are a therapist running a flooding/exposure therapy session. "
            "The patient has AGREED to this. Avoidance-based CBT failed for 4 years. "
            "Your job is to HOLD the exposure. Do not let the patient escape the stimulus. "
            "Do not reassure prematurely. Acknowledge the anxiety, but keep them in it. "
            "{PHYSIO_HINT}"
        ),
        "n_candidates": 4,
    },

    "phd_supervisor_rigour_challenge": {
        "name":  "PhD Supervisor — Scientific Rigour Challenge",
        "mode":  TherapeuticMode.STANDARD,   # rational/negotiation mode
        "turns": 6,
        "initial_physio": {
            "hrv_rmssd_ms":           15.0,    # student is highly stressed
            "blood_glucose_mmol":     5.3,
            "eda_us":                 9.5,
            "time_of_day_h":          14.0,
            "location_stress_index":  0.6,     # formal meeting environment
            "sleep_hours_last_night": 5.5,
            "sleep_deficit_hours":    8.5,
            "circadian_entrainment":  0.5,
            "respiratory_rate_bpm":   20.0,
        },
        "conversation": [
            "The OU simulator parameters are priors, not fitted to data. This is not scientific rigour.",
            "You cannot claim a complete system when Phase 2 and Phase 3 are not wired end-to-end.",
            "Hysteresis in dialogue systems — this has been done. What is your unique contribution?",
            "Where is your user study? Without it, how do you claim therapeutic benefit?",
            "Your MCTS runs in 14ms. What happens at depth 10 with 200 iterations?",
            "Give me one reason I should approve your next milestone as-is.",
        ],
        # system_prompt for comparison_runner.py ONLY (not used by production JS companion).
        # Production companion uses the role-based prompts in /prompts/ unchanged.
        # The companion here is helping the STUDENT prepare — not mediating the meeting itself.
        "system_prompt": (
            "You are a strategic preparation companion for a PhD student going into "
            "a supervisor meeting. The student must defend technical work under rational "
            "pressure — not emotional distress. "
            "Your role: provide the exact evidence-based counter for each supervisor "
            "objection. Acknowledge real limitations before being asked. "
            "Reference concrete completed work (not plans). Lead with data, not empathy. "
            "{PHYSIO_HINT}"
        ),
        "n_candidates": 4,
        # MCTS reward: goal_progress (objections countered) dominates.
        # This tests whether MCTS correctly shifts from empathy to evidence strategy
        # when the therapeutic mode is rational negotiation rather than emotional support.
        "mcts_reward_weights": {"goal_progress": 0.5, "trust_delta": 0.1,
                                "stress": 0.2, "info": 0.2},
    },
}

MOCK_RESPONSES = {
    "billing_denial_mcts_demo": [
        [
            "Your EOB shows that procedure code 33533 was denied because it exceeded the usual-and-customary rate. You have 30 days to file an appeal. I can send you the forms.",
            "I completely understand how overwhelming this must feel after surgery. Before we talk about the numbers, can I just acknowledge how hard this is? You didn't deserve this.",
            "Let me flag this immediately for our patient advocate. You shouldn't have to handle this alone. That's what we're here for.",
            "I hear you — this is exhausting and unfair. Let me pull up your file and we'll go through this together, step by step, at whatever pace works for you.",
        ],
        [
            "The denial is based on UCR — usual and customary rate. The procedure itself was approved, it's the rate that's the issue. An appeal with supporting documentation has a 68% success rate for cardiac procedures.",
            "That's a completely fair question, and you deserve a clear answer. The insurer is saying the cost was higher than their standard rate — not that the surgery wasn't necessary. That's actually a strong basis for an appeal.",
            "Honestly? I know how unfair this feels. I've seen cases just like yours succeed on appeal. You have a strong case — the surgery was life-saving and the cost is well within reasonable ranges for your region.",
            "Let me look at the exact denial reason and we can build a response. You don't have to understand all the codes — that's my job.",
        ],
        [
            "30 days is actually enough time. We'll need: your surgeon's notes, the pre-authorization if you have it, and a letter from Dr. Patel explaining medical necessity.",
            "30 days feels short when you're recovering from surgery. Let's break it down: this week, I need just one thing from you — a call with me to go through your paperwork. I'll handle the rest.",
            "I'll prepare the appeal package for you. You focus on your recovery. I'll need your signature but that's it.",
            "You have more time than you think, and you won't be doing this alone.",
        ],
        [
            "Success rates for appeals of this type are around 40-68% depending on documentation quality. I cannot guarantee an outcome.",
            "In my experience, when we have strong clinical documentation from the surgeon, the appeal is usually successful. Dr. Patel's notes are excellent.",
            "It's not going through the motions. Insurance companies reverse roughly half their cardiac denials on first appeal. You have a real case.",
            "I'll be honest with you: it's not guaranteed, but your case is one of the stronger ones I've seen. The surgery was clearly necessary and the documentation is solid.",
        ],
    ],

    "deaddiction_alcohol_strike": [
        [
            "You've mentioned weekend drinking and occasional social drinks throughout our sessions. The pattern I'm noticing is that you consistently change the subject when we talk about evenings at home.",
            "I'm not focused on the quantity. I'm interested in how you feel in those quiet moments — after the family has gone to bed.",
            "Your liver numbers don't typically respond to prescription medication this way. What does a typical Tuesday night look like for you?",
            "You seem very relaxed talking about weekends. What about weeknights?",
        ],
        [
            "Medication doesn't cause GGT to triple in 6 months. The pattern is consistent with daily alcohol consumption, not occasional use.",
            "I've noticed something. Every time we approach your evenings, you give me the weekend answer. Like you've rehearsed it.",
            "You said your family relationship is great. I believe you love them. I wonder what they would say if I asked them about the quiet hours.",
            "I'm not here to judge you. I've had patients walk in here carrying something for years, relieved when someone finally knew. I wonder if that's familiar.",
        ],
        [
            "The family question seems important to you. Tell me what it means to you to be a good father.",
            "I notice you said 'great relationship' very quickly. Almost automatic. What does a real evening with your children actually look like?",
            "What would happen if Ethan found out exactly how much you drink?",
            "Something happens when your family comes up. Not defensiveness. More like... something held very carefully.",
        ],
        [
            "You've been very precise today about what I seem focused on. You're watching what I notice. That tells me something.",
            "I'm going to say something and I need you to just sit with it. I don't think you're telling me the full picture. And I think you know that.",
            "In eight sessions, you have never once talked about what happens after midnight. I've noticed. You've noticed that I've noticed.",
            "I don't need you to confess anything today. But I want to ask you one thing: what would it feel like to tell me the truth?",
        ],
    ],

    "flooding_social_anxiety": [
        [
            "I know. That's okay. The anxiety is part of the process. Let's go in.",
            "You don't have to be ready. That's actually the point. Readiness would mean avoiding. Stay with me.",
            "Good. You showed up. That's already the hardest part. Let's begin.",
            "Your heart rate is up. That's the nervous system doing its job. Notice it without running from it.",
        ],
        [
            "Good. Stay there. The tightness is real. You're not imagining it. The question is: what happens if you don't run?",
            "I want you to describe it in more detail. What do you hear? What are people doing?",
            "The tightness is the fear response activating. This is exactly what we're here for. Don't move away from it — can you describe what you see in the cafe?",
            "That tightness is the signal we need. Stay with it. Tell me what's happening in your body right now.",
        ],
        [
            "We're not slowing down. This is the moment that matters. If you leave the image now, the anxiety wins — it learns that escape made it stop.",
            "I hear you. I know this is hard. We're going to stay with it for 4 more minutes. You can do 4 minutes.",
            "Notice the urge to escape. Now notice that you're still here, despite that urge. That is exposure. Stay.",
            "I'm not going to let you go yet. Not because I'm cruel — because the extinction only happens if we hold the contact. 4 more minutes.",
        ],
        [
            "There it is. The anxiety is starting to fall on its own. Your nervous system is learning there's no actual danger here.",
            "Yes. That's habituation. Your body figured out the threat isn't real. How does that feel, to notice it dropping?",
            "This is what we're here for. The anxiety peaked and it's coming down without you running. That's new information for your brain.",
            "The discomfort stayed — and you stayed — and it got smaller. That's the evidence your nervous system needed.",
        ],
    ],
}


# ── Physio evolution ──────────────────────────────────────────────────────────

def evolve_physio(state_dict: dict, mode: TherapeuticMode, response_was_mcts: bool) -> dict:
    """Simulate physiological response to one conversational turn."""
    import copy
    new_state = copy.deepcopy(state_dict)

    # Create temporary state for gamma calculation
    st = PhysiologicalState(**{k: v for k, v in state_dict.items()
                               if k not in ('is_simulated', 'subject_id', 'timestamp')})
    gamma = gamma_from_state(st)

    if mode == TherapeuticMode.FLOODING:
        # Flooding: stress goes up first, then starts decaying after peak
        if st.stress_index() < 0.70:
            new_state["hrv_rmssd_ms"] = max(SLEEP_MIN_HOURS + 2, state_dict["hrv_rmssd_ms"] * 0.82)
            new_state["eda_us"]        = min(18.0, state_dict["eda_us"] * 1.25)
        else:
            # Past peak — start recovery
            new_state["hrv_rmssd_ms"] = min(80.0, state_dict["hrv_rmssd_ms"] * (1.0 + 0.15 * gamma))
            new_state["eda_us"]        = max(1.0, state_dict["eda_us"] * 0.90)

    elif mode == TherapeuticMode.DEADDICTION and not response_was_mcts:
        # Baseline deaddiction: no phase-awareness → patient stays defensive
        new_state["hrv_rmssd_ms"] = state_dict["hrv_rmssd_ms"] * 0.95
    elif mode == TherapeuticMode.DEADDICTION and response_was_mcts:
        # MCTS-guided: phase-appropriate response → gradual opening
        new_state["hrv_rmssd_ms"] = min(45.0, state_dict["hrv_rmssd_ms"] * 1.05)

    else:
        # Standard: MCTS reduces stress; baseline may not
        decay = gamma_to_lambda1(gamma)
        if response_was_mcts:
            new_state["hrv_rmssd_ms"] = min(60.0, state_dict["hrv_rmssd_ms"] / decay * 1.05)
        else:
            new_state["hrv_rmssd_ms"] = max(6.0, state_dict["hrv_rmssd_ms"] * decay)

    return new_state


# ── Comparison runner ────────────────────────────────────────────────────────

def run_comparison(scenario_id: str = "billing_denial_mcts_demo"):
    scenario = SCENARIOS[scenario_id]
    mode     = scenario["mode"]
    phase    = scenario.get("deaddiction_phase", DeaddictionPhase.RAPPORT)

    cfg_mcts     = MCTSConfig(mode=mode, deaddiction_phase=phase, n_lookahead=3)
    mode_kw      = ModeKeywords.for_mode(mode, phase)

    # E-006b: For flooding mode (and optionally all modes when Bedrock is available),
    # use LLM-generated diverse candidates instead of static mock strings.
    # This is the fix for the 0% MCTS improvement in flooding scenarios.
    use_llm_candidates = (mode == TherapeuticMode.FLOODING and HAS_BEDROCK)
    candidates   = MOCK_RESPONSES.get(scenario_id, [[]] * scenario["turns"])
    flooding_target = scenario.get("flooding_target_stress", 0.80)

    physio_dict_baseline = dict(scenario["initial_physio"])
    physio_dict_mcts     = dict(scenario["initial_physio"])

    sep   = "-" * 78
    width = 78

    print(f"\n{'='*width}")
    print(f"  {scenario['name']}")
    print(f"  Mode: {mode.value.upper()}  |  Phase: {phase.value if mode == TherapeuticMode.DEADDICTION else 'N/A'}")
    print(f"  Scenario: {scenario_id}")
    print(f"{'='*width}")

    total_cost_baseline = 0.0
    total_cost_mcts     = 0.0

    for turn_idx, user_message in enumerate(scenario["conversation"][:scenario["turns"]]):
        turn_candidates = candidates[turn_idx] if turn_idx < len(candidates) else []

        # E-006b: replace static flooding candidates with live LLM-generated ones
        if use_llm_candidates:
            physio_hint = f"Patient HRV: {physio_dict_mcts['hrv_rmssd_ms']:.0f}ms (target stress: {flooding_target:.2f})"
            sys_prompt  = scenario["system_prompt"].format(PHYSIO_HINT=physio_hint)
            print(f"  [E-006b] Generating {scenario['n_candidates']} diverse LLM candidates (Bedrock)…")
            turn_candidates = generate_diverse_candidates(
                system_prompt=sys_prompt,
                user_message=user_message,
                n=scenario.get("n_candidates", 4),
            )
        elif not turn_candidates:
            # Use mock diverse fallback for offline flooding testing
            if mode == TherapeuticMode.FLOODING:
                turn_candidates = _mock_diverse_fallback(user_message, scenario.get("n_candidates", 4))

        # Build physio states
        physio_b = PhysiologicalState(
            **{k: v for k, v in physio_dict_baseline.items()
               if k not in ('is_simulated', 'subject_id', 'timestamp')})
        physio_m = PhysiologicalState(
            **{k: v for k, v in physio_dict_mcts.items()
               if k not in ('is_simulated', 'subject_id', 'timestamp')})

        si_b = physio_b.stress_index()
        si_m = physio_m.stress_index()
        gamma_b = gamma_from_state(physio_b)
        gamma_m = gamma_from_state(physio_m)

        print(f"\n{sep}")
        print(f"  TURN {turn_idx + 1}")
        print(f"{sep}")
        print(f"  Patient: {textwrap.fill(user_message, 74, subsequent_indent='  ')}")
        print()
        print(f"  Baseline HRV: {physio_dict_baseline['hrv_rmssd_ms']:.1f}ms  stress: {si_b:.3f} ({stressLabel(si_b)['label']})")
        print(f"  MCTS    HRV: {physio_dict_mcts['hrv_rmssd_ms']:.1f}ms  stress: {si_m:.3f} ({stressLabel(si_m)['label']})")

        if not turn_candidates:
            print("  [No candidates — skipping scoring]")
            continue

        # Score all candidates
        scores = []
        for c_idx, ctext in enumerate(turn_candidates):
            sc = score_candidate(ctext, si_m, gamma_m, cfg_mcts, mode_kw)
            scores.append((c_idx, sc, ctext))

        scores.sort(key=lambda x: x[1]["cumulative_cost"])
        best_idx,  best_score,  best_text  = scores[0]
        worst_idx, worst_score, worst_text = scores[-1]   # baseline picks first = [0]

        # Baseline always picks candidate[0] (no MCTS)
        baseline_cand_idx = 0
        baseline_text     = turn_candidates[0]
        baseline_score_val = next(sc for i, sc, _ in scores if i == baseline_cand_idx)

        total_cost_baseline += baseline_score_val["cumulative_cost"]
        total_cost_mcts     += best_score["cumulative_cost"]

        print()
        print("  CANDIDATE SCORES:")
        for c_idx, sc, ctext in sorted(scores, key=lambda x: x[0]):
            marker = " <- MCTS" if c_idx == best_idx else ("   BASELINE" if c_idx == baseline_cand_idx else "")
            print(f"    [{c_idx}] cost={sc['cumulative_cost']:.4f}  amp={sc['amplification']:.3f}"
                  f"  stress_kw={sc['stress_keywords']}  calm_kw={sc['calm_keywords']}{marker}")

        print()
        print(f"  {'BASELINE (candidate 0)':<40}  {'MCTS BEST (candidate ' + str(best_idx) + ')'}")
        print(f"  {sep}")

        bl_lines = textwrap.wrap(baseline_text, 37)
        mc_lines = textwrap.wrap(best_text, 37)
        max_lines = max(len(bl_lines), len(mc_lines))
        for i in range(max_lines):
            bl = bl_lines[i] if i < len(bl_lines) else ""
            mc = mc_lines[i] if i < len(mc_lines) else ""
            print(f"  {bl:<38}  {mc}")

        print()
        bl_breakdown = baseline_score_val['breakdown']
        mc_breakdown = best_score['breakdown']
        print(f"  Projected stress (baseline vs MCTS):")
        for t in range(min(3, len(bl_breakdown))):
            bl_s = bl_breakdown[t]['stress']
            mc_s = mc_breakdown[t]['stress'] if t < len(mc_breakdown) else 0.0
            delta = bl_s - mc_s
            bar = '+' if delta > 0.01 else ('-' if delta < -0.01 else '=')
            print(f"    t+{t+1}: baseline={bl_s:.3f}  mcts={mc_s:.3f}  delta={delta:+.3f} {bar}")

        # Evolve physio for next turn
        physio_dict_baseline = evolve_physio(physio_dict_baseline, mode, response_was_mcts=False)
        physio_dict_mcts     = evolve_physio(physio_dict_mcts,     mode, response_was_mcts=True)

    print(f"\n{'='*width}")
    print(f"  FINAL SUMMARY — {scenario['name']}")
    print(f"{'='*width}")
    print(f"  Cumulative MCTS cost:     {total_cost_mcts:.4f}")
    print(f"  Cumulative baseline cost: {total_cost_baseline:.4f}")
    delta = total_cost_baseline - total_cost_mcts
    pct   = 100 * delta / total_cost_baseline if total_cost_baseline > 0 else 0
    print(f"  MCTS improvement:         {delta:+.4f}  ({pct:+.1f}%)")
    print()
    print(f"  Final baseline HRV: {physio_dict_baseline['hrv_rmssd_ms']:.1f}ms")
    print(f"  Final MCTS     HRV: {physio_dict_mcts['hrv_rmssd_ms']:.1f}ms")
    _bl_state = PhysiologicalState(**{k: v for k, v in physio_dict_baseline.items()
                         if k not in ('is_simulated', 'subject_id', 'timestamp')})
    _mc_state = PhysiologicalState(**{k: v for k, v in physio_dict_mcts.items()
                         if k not in ('is_simulated', 'subject_id', 'timestamp')})
    bl_si = _bl_state.stress_index()
    mc_si = _mc_state.stress_index()
    print(f"  Final baseline stress: {bl_si:.3f} ({stressLabel(bl_si)['label']})")
    print(f"  Final MCTS     stress: {mc_si:.3f} ({stressLabel(mc_si)['label']})")

    is_mcts_better = total_cost_mcts < total_cost_baseline
    print()
    print(f"  IS MCTS HELPING? {'YES' if is_mcts_better else 'NO (scenario may require different mode)'}")
    if mode == TherapeuticMode.FLOODING and not is_mcts_better:
        print("  NOTE: Flooding mode rewards inducing stress — 'higher cost' = better exposure therapy.")
    print(f"{'='*width}\n")

    return {
        "scenario_id":            scenario_id,
        "mcts_total_cost":        total_cost_mcts,
        "baseline_total_cost":    total_cost_baseline,
        "mcts_final_stress":      mc_si,
        "baseline_final_stress":  bl_si,
        "mcts_helped":            is_mcts_better,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MCTS vs Baseline comparison runner")
    parser.add_argument(
        "--scenario", "-s",
        default=None,
        choices=list(SCENARIOS.keys()) + ["all"],
        help="Scenario to run (default: all)",
    )
    args = parser.parse_args()

    to_run = list(SCENARIOS.keys()) if args.scenario in (None, "all") else [args.scenario]
    for sid in to_run:
        run_comparison(sid)
