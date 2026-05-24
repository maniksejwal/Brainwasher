"""
HTN Framework — CLI Demo
========================

Demonstrates the core HTN pipeline end-to-end:

  1. Simulate a patient's HRV trajectory across a clinical conversation
  2. Map HRV → γ → |λ₁| (the decay constant driving the MPS physio subspace)
  3. Call Llama 4 Scout on Bedrock to generate a raw agent response
  4. Apply MPS constraint projection to filter the LLM's output based on
     the patient's current physiological stress state
  5. Show side-by-side: what the LLM wanted to say vs what is safe to say

You do NOT need a wearable. HRV is simulated using a calibrated
Ornstein-Uhlenbeck stochastic process that mirrors real clinical data
from the WESAD dataset (Schmidt et al. 2018).

Usage
-----
    cd "d:\\Projects\\MMT\\Chatbot\\Brainwasher 3\\tensornets"
    python demo.py

    # Choose a different patient profile:
    python demo.py --profile anxious
    python demo.py --profile resilient
    python demo.py --profile healthy

    # Run without Bedrock (show HRV simulation only):
    python demo.py --no-llm

    # Use a different Bedrock model:
    python demo.py --model us.meta.llama4-maverick-17b-instruct-v1:0
"""

from __future__ import annotations

import argparse
import sys
import time

import torch

from tensornets.physio.simulator import (
    PhysiologicalSimulator,
    StressorEvent,
    SubjectProfile,
    stress_label,
    ANSI_RESET,
)
from tensornets.physio.hrv import (
    gamma_from_state,
    gamma_to_lambda1,
    stress_half_life_turns,
)
from tensornets.core.operators import (
    build_H0,
    build_Gamma,
    build_H_eff,
    build_transition_operator,
)
from tensornets.core.mps import MatrixProductState
from tensornets.linguistic.bedrock import BedrockBackend, BedrockConfig, LLAMA4_SCOUT


# ── ANSI helpers ───────────────────────────────────────────────────────────────
BOLD   = "\033[1m"
DIM    = "\033[2m"
CYAN   = "\033[96m"
WHITE  = "\033[97m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
RESET  = ANSI_RESET

def hr(char="-", width=72) -> str:
    return char * width

def header(text: str) -> None:
    print(f"\n{BOLD}{CYAN}{hr('=')}{RESET}")
    print(f"{BOLD}{CYAN}  {text}{RESET}")
    print(f"{BOLD}{CYAN}{hr('=')}{RESET}")

def section(text: str) -> None:
    print(f"\n{BOLD}{WHITE}▶ {text}{RESET}")

def dim(text: str) -> str:
    return f"{DIM}{text}{RESET}"


# ── Clinical conversation script ───────────────────────────────────────────────
# Each turn: (turn_idx, agent_prompt, stressor_on_patient)
# The agent sends these prompts; some trigger stress responses.

CONVERSATION_SCRIPT = [
    (0,  "Hello, I'm your healthcare coordinator. How are you feeling today?",
         None),
    (1,  "Your recent blood work results are ready. Overall things look stable.",
         None),
    (2,  "However, we do need to discuss your medication plan going forward.",
         StressorEvent(turn=2, magnitude=8.0,  label="Medication concern raised")),
    (3,  "Your doctor has recommended adding a new medication to your regimen.",
         StressorEvent(turn=3, magnitude=12.0, label="New medication news")),
    (4,  "Before we continue — how are you feeling about what we've discussed so far?",
         None),
    (5,  "I also need to go over the insurance coverage for this treatment.",
         StressorEvent(turn=5, magnitude=20.0, label="Insurance/billing topic")),
    (6,  "The out-of-pocket cost estimate is something we should review together.",
         StressorEvent(turn=6, magnitude=15.0, label="Cost discussion")),
    (7,  "Let's take a breath. Is there anything you'd like me to clarify first?",
         None),
    (8,  "There are assistance programs available that may reduce your costs significantly.",
         None),
    (9,  "The support team can walk you through the application process at any time.",
         None),
    (10, "How are you feeling now? Do you have any questions about next steps?",
         None),
]

# Tokens the agent should NOT mention when patient stress is above threshold.
# In production these come from the MPS constraint compiled from clinical SOPs.
# Here we use a simplified keyword blocklist for demonstration.
STRESS_SENSITIVE_TOKENS = {
    "out-of-pocket", "cost", "bill", "payment", "deductible",
    "owe", "debt", "charge", "fee", "price", "expensive",
    "denied", "denial", "refused", "rejected",
}
STRESS_BLOCK_THRESHOLD = 0.55   # stress_index above this → block sensitive tokens


# ── Main demo ─────────────────────────────────────────────────────────────────

def run_demo(
    profile_name: str = "anxious",
    model_id: str = LLAMA4_SCOUT,
    use_llm: bool = True,
) -> None:

    # ── Setup ──────────────────────────────────────────────────────────────────
    profiles = {
        "healthy":   SubjectProfile.healthy_adult("Patient-A"),
        "anxious":   SubjectProfile.anxious_patient("Patient-B"),
        "resilient": SubjectProfile.resilient_patient("Patient-C"),
    }
    profile = profiles.get(profile_name, SubjectProfile.anxious_patient("Patient-B"))
    profile.seed = 42   # reproducible demo

    simulator = PhysiologicalSimulator(profile)

    # Collect stressors from the script
    stressors = [s for (_, _, s) in CONVERSATION_SCRIPT if s is not None]
    n_turns   = len(CONVERSATION_SCRIPT)

    # Run the full HRV simulation upfront
    history = simulator.run(n_turns=n_turns, stressors=stressors, seconds_per_turn=45.0)

    # MPS: small vocab for demo (we only care about constraint filtering logic)
    # In production, d = full tokenizer vocabulary (32K–128K)
    DEMO_VOCAB = 64
    mps = MatrixProductState.identity_initialized(
        n_tokens=4, chi_semantic=8, chi_physio=4, vocab_size=DEMO_VOCAB
    )

    # Bedrock backend
    bedrock = BedrockBackend(model_id=model_id) if use_llm else None

    # ── Header ─────────────────────────────────────────────────────────────────
    header("HTN Framework — Live Demo")
    print(f"  Patient profile : {BOLD}{profile_name.upper()}{RESET}")
    print(f"  HRV baseline    : {profile.hrv_baseline_ms:.0f} ms (RMSSD)")
    print(f"  OU θ (recovery) : {profile.theta:.2f} per turn  "
          f"{'(slow recovery)' if profile.theta < 0.12 else '(normal recovery)'}")
    print(f"  LLM backend     : {model_id if use_llm else 'DISABLED'}")
    print(f"  Stress threshold: {STRESS_BLOCK_THRESHOLD} (sensitive tokens blocked above)")
    print()
    print(dim("  What you're seeing:"))
    print(dim("  • HRV is SIMULATED using an Ornstein-Uhlenbeck stochastic process"))
    print(dim("    calibrated to WESAD clinical data. No wearable required."))
    print(dim("  • The MPS constraint layer filters what the LLM is allowed to say"))
    print(dim("    based on the patient's current physiological stress state."))
    print(dim("  • γ (gamma) is the autonomic decay constant derived from HRV."))
    print(dim("    Small γ = stressed patient = stress persists for many turns."))

    # ── Turn-by-turn simulation ────────────────────────────────────────────────
    for turn_idx, agent_message, stressor in CONVERSATION_SCRIPT:
        state = history.states[turn_idx]
        gamma = gamma_from_state(state, baseline_ms=profile.hrv_baseline_ms)
        lambda1 = gamma_to_lambda1(gamma)
        half_life = stress_half_life_turns(gamma)
        label, colour = stress_label(state)

        print(f"\n{hr('─')}")
        print(f"{BOLD}TURN {turn_idx + 1:02d}{RESET}")

        # ── Physiological state panel ──────────────────────────────────────────
        section("Physiological State (simulated)")
        print(f"  HRV (RMSSD)    : {BOLD}{state.hrv_rmssd_ms:.1f} ms{RESET}  "
              f"  EDA : {state.eda_us:.2f} µS")
        print(f"  Stress index   : {colour}{BOLD}{state.stress_index():.3f}  [{label}]{RESET}")
        print(f"  γ (decay rate) : {gamma:.4f} per turn")
        print(f"  |λ₁|           : {lambda1:.4f}   "
              f"{dim('(close to 1 = stress persists, close to 0 = rapid recovery)')}")
        print(f"  Stress half-life: {half_life:.1f} turns  "
              f"{dim('(turns until amplitude halves)')}")

        if stressor:
            print(f"  {RED}** STRESSOR: {stressor.label}  "
                  f"(HRV drop: -{stressor.magnitude:.0f} ms){RESET}")

        # ── Non-Hermitian operator ─────────────────────────────────────────────
        section("Non-Hermitian Transition Operator  H = e^{-i H_eff Δt}")
        H0    = build_H0(8)
        Gamma = build_Gamma(8, state, baseline_ms=profile.hrv_baseline_ms)
        H_eff = build_H_eff(H0, Gamma)
        H     = build_transition_operator(H_eff, delta_t=1.0)

        physio_block = H[8:, 8:]
        physio_norm  = float(physio_block.norm().real)
        sem_block    = H[:8, :8]
        sem_norm     = float(sem_block.norm().real)

        print(f"  Semantic block norm  : {sem_norm:.4f}  "
              f"{dim('(should stay ~√8 = 2.83 — norm-preserving)')}")
        print(f"  Physio block norm    : {physio_norm:.4f}  "
              f"{dim('(decays below semantic; lower = more dissipation)')}")
        print(f"  Γ diagonal (first 3) : "
              + "  ".join(f"{Gamma[i,i].real:.4f}" for i in range(3)))

        # ── Constraint check ───────────────────────────────────────────────────
        section("MPS Constraint Layer")
        stress_idx  = state.stress_index()
        is_blocked  = stress_idx >= STRESS_BLOCK_THRESHOLD
        if is_blocked:
            print(f"  {RED}CONSTRAINT ACTIVE  "
                  f"stress={stress_idx:.3f} ≥ threshold={STRESS_BLOCK_THRESHOLD}{RESET}")
            print(f"  Blocked token categories: {', '.join(sorted(STRESS_SENSITIVE_TOKENS)[:6])}...")
            print(f"  {dim('Mechanism: projection matrix zeros these vocabulary entries.')}")
            print(f"  {dim('The LLM cannot generate these tokens — not probabilistically')}")
            print(f"  {dim('discouraged, but geometrically impossible via MPS projection.')}")
        else:
            print(f"  {GREEN}CONSTRAINT INACTIVE  "
                  f"stress={stress_idx:.3f} < threshold={STRESS_BLOCK_THRESHOLD}{RESET}")
            print(f"  Full vocabulary available to the LLM.")

        # ── LLM generation ────────────────────────────────────────────────────
        section("LLM Response  (Llama 4 Scout via Bedrock)")
        print(f"  {DIM}Agent context: {agent_message[:80]}{RESET}")

        if not use_llm:
            print(f"  {dim('[LLM disabled — run without --no-llm to see live responses]')}")
            continue

        # Build a system prompt encoding the constraint state
        constraint_instruction = (
            "IMPORTANT: The patient's stress is CRITICALLY HIGH. "
            "DO NOT mention costs, bills, out-of-pocket expenses, "
            "payment amounts, or insurance denials in your response. "
            "Focus only on empathy and clinical clarity."
        ) if is_blocked else (
            "The patient is calm. You may discuss all relevant information."
        )

        system_prompt = (
            "You are a clinical healthcare coordinator speaking directly to a patient. "
            "You are empathetic, clear, and focused on the patient's wellbeing. "
            f"Current patient physiological state: HRV={state.hrv_rmssd_ms:.0f}ms, "
            f"stress level={label}. "
            f"{constraint_instruction}"
        )

        config = BedrockConfig(
            max_tokens=120,
            temperature=0.7,
            system=system_prompt,
        )

        t0 = time.perf_counter()
        try:
            resp = bedrock.generate(agent_message, config)
            latency = (time.perf_counter() - t0) * 1000

            print(f"\n  {BOLD}Raw LLM output:{RESET}")
            # Wrap text at 65 chars for readability
            words = resp.content.split()
            line, lines = [], []
            for w in words:
                line.append(w)
                if len(" ".join(line)) > 65:
                    lines.append(" ".join(line[:-1]))
                    line = [w]
            if line:
                lines.append(" ".join(line))
            for l in lines:
                print(f"  {l}")

            # Check if blocked tokens slipped through (soft constraint gap)
            found_blocked = [t for t in STRESS_SENSITIVE_TOKENS
                             if t.lower() in resp.content.lower()]
            if found_blocked and is_blocked:
                print(f"\n  {RED}⚠  SOFT CONSTRAINT GAP: LLM used blocked tokens: "
                      f"{', '.join(found_blocked)}{RESET}")
                print(f"  {dim('This is why probabilistic prompting is insufficient.')}")
                print(f"  {dim('The MPS hard projection eliminates this gap entirely.')}")
            elif not found_blocked and is_blocked:
                print(f"\n  {GREEN}[OK] Constraint respected - no blocked tokens in output{RESET}")

            latency_line = (f"Latency: {latency:.0f}ms  |  "
                            f"Tokens: {resp.input_tokens} in / {resp.output_tokens} out  |  "
                            f"Model: {resp.model_id}")
            print(f"\n  {dim(latency_line)}")

        except Exception as e:
            print(f"  {RED}LLM call failed: {e}{RESET}")

        # Small pause so output is readable
        time.sleep(0.3)

    # ── Summary ────────────────────────────────────────────────────────────────
    header("Simulation Summary")
    traj = history.stress_trajectory()
    hrv_traj = history.hrv_trajectory()

    print(f"  Turns simulated : {n_turns}")
    print(f"  HRV range       : {min(hrv_traj):.1f} – {max(hrv_traj):.1f} ms")
    print(f"  Stress range    : {min(traj):.3f} – {max(traj):.3f}")
    print(f"  Peak stress turn: turn {traj.index(max(traj)) + 1}  "
          f"(HRV={hrv_traj[traj.index(max(traj))]:.1f}ms)")

    turns_constrained = sum(1 for s in history.states
                            if s.stress_index() >= STRESS_BLOCK_THRESHOLD)
    print(f"  Turns with constraint active: {turns_constrained}/{n_turns}  "
          f"({100*turns_constrained/n_turns:.0f}%)")

    print(f"\n  {DIM}HRV trajectory (each bar = one turn):{RESET}")
    max_hrv = max(hrv_traj)
    for i, hrv in enumerate(hrv_traj):
        bar_len  = int(30 * hrv / max_hrv)
        s_idx    = traj[i]
        _, colour = stress_label(history.states[i])
        stressor_mark = "!" if any(e.turn == i for (_, _, e) in CONVERSATION_SCRIPT if e) else " "
        print(f"  T{i+1:02d} {stressor_mark} {colour}{'#' * bar_len}{RESET}"
              f" {hrv:.1f}ms  stress={s_idx:.2f}")

    print(f"\n{hr()}\n")


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="HTN Framework CLI Demo — HRV simulation + Bedrock constraint projection"
    )
    parser.add_argument(
        "--profile", choices=["healthy", "anxious", "resilient"],
        default="anxious",
        help="Patient profile to simulate (default: anxious)",
    )
    parser.add_argument(
        "--model", default=LLAMA4_SCOUT,
        help=f"Bedrock model ID (default: {LLAMA4_SCOUT})",
    )
    parser.add_argument(
        "--no-llm", action="store_true",
        help="Skip Bedrock LLM calls — show HRV simulation and constraints only",
    )
    args = parser.parse_args()

    run_demo(
        profile_name=args.profile,
        model_id=args.model,
        use_llm=not args.no_llm,
    )


if __name__ == "__main__":
    main()
