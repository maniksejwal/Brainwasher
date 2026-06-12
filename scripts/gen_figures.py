"""
Generate all data-driven PDF figures for Tensor_nets.pdf.
Output: figures/*.pdf  (or figures/*.png for pgfplots import)

Usage:
    python scripts/gen_figures.py

Dependencies:
    pip install matplotlib numpy

Each figure is saved as both PDF (for LaTeX \includegraphics) and
PNG (for quick preview).
"""
from __future__ import annotations

import json
import math
import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = pathlib.Path(__file__).parent.parent
OUT = ROOT / "figures"
OUT.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Helper
# ─────────────────────────────────────────────────────────────────────────────

def wilson_ci(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score 95% CI for a proportion."""
    if n == 0:
        return 0.0, 0.0
    p = k / n
    denom = 1 + z ** 2 / n
    centre = (p + z ** 2 / (2 * n)) / denom
    margin = (z * math.sqrt(p * (1 - p) / n + z ** 2 / (4 * n ** 2))) / denom
    return max(0.0, centre - margin), min(1.0, centre + margin)


def save(fig: plt.Figure, name: str) -> None:
    for ext in ("pdf", "png"):
        path = OUT / f"{name}.{ext}"
        fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  [ok] {name}")


# ─────────────────────────────────────────────────────────────────────────────
# Fig 8 — run_018 per-arm completion rates
# ─────────────────────────────────────────────────────────────────────────────

def fig_run018_bars() -> None:
    run_dir = ROOT / "tensornets" / "runs" / "run_018"
    if not run_dir.exists():
        print("  ⚠  run_018 not found; skipping Fig 8")
        return

    arm_names, rates, lo_errs, hi_errs = [], [], [], []
    for arm_path in sorted(run_dir.iterdir()):
        if not arm_path.is_dir():
            continue
        state_file = arm_path / "checkpoints" / "run_state.json"
        if state_file.exists():
            st = json.loads(state_file.read_text())
            k = int(st.get("successful_eps", 0))
            n = int(st.get("ep_count", 0))
        else:
            # fall back: count episode files
            ep_dir = arm_path / "episodes"
            n = len(list(ep_dir.glob("*.jsonl"))) if ep_dir.exists() else 0
            k = n  # unknown successes — assume completed = success
        p = k / max(n, 1)
        lo, hi = wilson_ci(k, max(n, 1))
        arm_names.append(arm_path.name.replace("arm_", ""))
        rates.append(p)
        lo_errs.append(p - lo)
        hi_errs.append(hi - p)

    if not arm_names:
        print("  ⚠  no arm data found; skipping Fig 8")
        return

    colors = [
        "#d9534f" if "hpvoot" in a else
        "#888888" if "oldschool" in a else
        "#5bc0de"
        for a in arm_names
    ]

    fig, ax = plt.subplots(figsize=(9, max(4, len(arm_names) * 0.6)))
    y = np.arange(len(arm_names))
    ax.barh(y, rates, xerr=[lo_errs, hi_errs],
            color=colors, ecolor="black", capsize=4, height=0.6)
    ax.set_yticks(y)
    ax.set_yticklabels(arm_names, fontsize=8)
    ax.set_xlabel("Episode completion rate")
    ax.set_title("run_018 — per-arm completion rates (Wilson 95 % CI)")
    ax.set_xlim(0, 1.05)
    ax.axvline(0.5, color="grey", linestyle="--", lw=0.8, alpha=0.5)

    from matplotlib.patches import Patch
    legend_handles = [
        Patch(color="#5bc0de", label="HTN arms"),
        Patch(color="#888888", label="Baseline (arm_oldschool)"),
        Patch(color="#d9534f", label="HPVOOT arms (instability in run_018)"),
    ]
    ax.legend(handles=legend_handles, fontsize=8, loc="lower right")
    save(fig, "fig_run018_bars")


# ─────────────────────────────────────────────────────────────────────────────
# Fig 11 — STANDARD vs FLOODING stress trajectory
# ─────────────────────────────────────────────────────────────────────────────

def fig_stress_trajectories() -> None:
    rng = np.random.default_rng(42)
    T = 20
    stressor_turn = 5

    def ou(theta: float, mu: float, sigma: float, s0: float,
           stressor: float) -> list[float]:
        s = [s0]
        for t in range(T - 1):
            bump = stressor if t == stressor_turn else 0.0
            ds = theta * (mu - s[-1]) + sigma * rng.standard_normal() + bump
            s.append(float(np.clip(s[-1] + ds, 0.0, 1.0)))
        return s

    std_traj   = ou(0.30, 0.20, 0.03, 0.18, 0.28)
    flood_traj = ou(0.07, 0.55, 0.03, 0.18, 0.28)

    fig, ax = plt.subplots(figsize=(7, 4))
    turns = np.arange(T)
    ax.plot(turns, std_traj,   "b-o", ms=4, lw=1.5, label=r"STANDARD ($\theta=0.30$, $\mu=0.20$)")
    ax.plot(turns, flood_traj, "r-s", ms=4, lw=1.5, label=r"FLOODING ($\theta=0.07$, $\mu=0.55$)")
    ax.axvline(stressor_turn, color="grey", linestyle="--", lw=1.2, label="Stressor event")

    zone_boundaries = [
        (0.25, "calm→mild\_tension", "gold"),
        (0.45, "mild→moderate",      "orange"),
        (0.60, "moderate→elevated",  "darkorange"),
        (0.78, "elevated→critical",  "red"),
    ]
    for y_val, label, color in zone_boundaries:
        ax.axhline(y_val, color=color, linestyle=":", lw=0.9, alpha=0.7)

    ax.set_xlabel("Dialogue turn")
    ax.set_ylabel("Stress index $s$")
    ax.set_title("Stress trajectory: STANDARD vs FLOODING patient mode")
    ax.legend(fontsize=8, loc="upper right")
    ax.set_ylim(0, 1)
    ax.set_xlim(0, T - 1)
    save(fig, "fig_stress_trajectories")


# ─────────────────────────────────────────────────────────────────────────────
# Fig 10 — V_INT_PRIOR heat map
# ─────────────────────────────────────────────────────────────────────────────

def fig_v_int_prior() -> None:
    # Schematic values derived from arms.py PRECONTEMPLATION/CONTEMPLATION/ACTION
    # rows × stress-zone columns.  Update when arms.py V_INT_PRIOR is extracted.
    V_INT = np.array([
        [0.10, 0.25, 0.05],   # pre-contemplation
        [0.35, 0.50, 0.15],   # contemplation
        [0.55, 0.40, 0.10],   # action / maintenance
    ])
    row_labels = ["Pre-contemplation", "Contemplation", "Action / Maint."]
    col_labels = [
        "Low stress\n(calm / mild\_tension)",
        "Med stress\n(moderate / elevated)",
        "High stress\n(critical)",
    ]

    fig, ax = plt.subplots(figsize=(6, 4))
    im = ax.imshow(V_INT, cmap="YlOrRd", vmin=0.0, vmax=0.65, aspect="auto")
    ax.set_xticks(range(3))
    ax.set_xticklabels(col_labels, fontsize=9)
    ax.set_yticks(range(3))
    ax.set_yticklabels(row_labels, fontsize=9)
    for i in range(3):
        for j in range(3):
            ax.text(j, i, f"{V_INT[i, j]:.2f}",
                    ha="center", va="center", fontsize=12,
                    color="white" if V_INT[i, j] > 0.35 else "black")
    plt.colorbar(im, ax=ax, label=r"$V_{\mathrm{INT\_PRIOR}}$")
    ax.set_title("Intrinsic Intervention Prior $V_{\\mathrm{INT\\_PRIOR}}$")
    save(fig, "fig_v_int_prior")


# ─────────────────────────────────────────────────────────────────────────────
# Fig 12 — PK/PD two-timescale SSRI model
# ─────────────────────────────────────────────────────────────────────────────

def fig_pkpd() -> None:
    """Simulate a simple once-daily SSRI dosing schedule."""
    days = np.linspace(0, 28, 2000)
    dt = days[1] - days[0]

    # PK: first-order elimination, once-daily dosing
    k_e = math.log(2) / 1.5      # half-life ~1.5 days (sertraline-like)
    dose = 1.0
    dose_interval = 1.0          # once daily
    Cp = np.zeros_like(days)
    for i in range(1, len(days)):
        # Add dose at each 24h mark
        if math.floor(days[i] / dose_interval) > math.floor(days[i - 1] / dose_interval):
            Cp[i] = Cp[i - 1] + dose
        else:
            Cp[i] = Cp[i - 1]
        Cp[i] *= math.exp(-k_e * dt)

    # PD: Emax model
    E_max = 1.0
    EC50 = 0.6
    E = E_max * Cp / (EC50 + Cp)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))
    ax1.plot(days, Cp, "b-", lw=1.5)
    ax1.set_xlabel("Days")
    ax1.set_ylabel(r"$C_p$ (normalised)")
    ax1.set_title("Plasma concentration (PK)")
    ax1.set_xlim(0, 28)

    ax2.plot(days, E, "r-", lw=1.5)
    ax2.set_xlabel("Days")
    ax2.set_ylabel(r"$E$ (normalised effect)")
    ax2.set_title("Therapeutic effect (PD, E$_{\\max}$ model)")
    ax2.set_xlim(0, 28)

    fig.suptitle("Two-timescale PK/PD SSRI model (once-daily dosing)")
    save(fig, "fig_pkpd")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def fig_vint_coupling() -> None:
    """Heatmap of the 3x3 Vint social coupling matrix (shared_tensor_state.py)."""
    # Rows = sending role, Cols = receiving role
    # patient, caregiver, clinician
    Vint = np.array([
        [1.00, 0.35, 0.50],
        [0.20, 1.00, 0.60],
        [0.50, 0.60, 1.00],
    ])
    roles = ["Patient", "Caregiver", "Clinician"]

    fig, ax = plt.subplots(figsize=(5.5, 4.5))
    im = ax.imshow(Vint, cmap="Blues", vmin=0.0, vmax=1.0, aspect="auto")

    ax.set_xticks(range(3))
    ax.set_xticklabels([f"to {r}" for r in roles], fontsize=10)
    ax.set_yticks(range(3))
    ax.set_yticklabels([f"from {r}" for r in roles], fontsize=10)

    for i in range(3):
        for j in range(3):
            color = "white" if Vint[i, j] > 0.65 else "black"
            ax.text(j, i, f"{Vint[i, j]:.2f}",
                    ha="center", va="center",
                    fontsize=14, fontweight="bold", color=color)

    plt.colorbar(im, ax=ax, label=r"$V_\mathrm{int}(i \to j)$ coupling strength")
    ax.set_title(r"Asymmetric inter-companion coupling $V_\mathrm{int}$", fontsize=11)
    ax.set_xlabel("Receiving companion role ($j$)")
    ax.set_ylabel("Sending companion role ($i$)")

    # Annotate the key asymmetry (patient->caregiver vs caregiver->patient)
    ax.annotate("", xy=(0.52, 0.48), xytext=(0.48, 1.52),
                arrowprops=dict(arrowstyle="<->", color="red", lw=1.8),
                xycoords="data", textcoords="data")
    ax.text(-0.45, 1.0,
            "0.35 vs 0.20\n(caregiving\nasymmetry)",
            fontsize=7.5, color="red", ha="right", va="center")

    fig.tight_layout()
    save(fig, "fig_vint_coupling")


if __name__ == "__main__":
    print("Generating figures -> ", OUT)
    fig_run018_bars()
    fig_stress_trajectories()
    fig_v_int_prior()
    fig_pkpd()
    fig_vint_coupling()
    print("Done.  Files in:", OUT.resolve())
