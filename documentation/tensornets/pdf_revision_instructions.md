# PDF Revision Instructions -- Tensor_nets.pdf (Overleaf Insertion Guide)

> **How to use this file**
>
> Each block below specifies exactly where in your `.tex` source to insert new
> content. Every insertion has three parts:
>
> 1. **ANCHOR BEFORE** -- the exact sentence or paragraph that immediately
>    precedes the insertion point (Ctrl+F in Overleaf to locate it).
> 2. **INSERT THIS** -- the LaTeX text to paste immediately after the anchor.
> 3. **ANCHOR AFTER** -- the sentence or paragraph that should follow the
>    insertion (use this to verify position after pasting).
>
> Insertions are listed in document order (Sec 1 -> 2 -> 3 -> 4 -> 5 -> 6).
> Work top-to-bottom; numbering shifts as you add content so always re-verify
> anchors after each block.
>
> BibTeX keys correspond to `docs/tensornets/references.bib`.

---

## PART A -- Factual Corrections (apply first, before adding new content)

These correct errors in the current PDF text. Apply them before Part B so
that anchor sentences for Part B are already in their corrected form.

---

### A1 -- M_trunc: hint, not logit constraint

**ANCHOR BEFORE**
> "The truncated bond matrix $M_\text{trunc}$ is used to constrain the logit
> output of the Scout LLM to the top-$k$ action subspace."

**INSERT THIS (replace the sentence above with)**
```latex
The truncated bond matrix $M_\text{trunc}$ is injected into the Scout LLM
system prompt as a soft \emph{hint} indicating the MCTS-preferred action
subspace; it does not constrain the logit distribution directly.
The LLM remains free to generate any action, and $M_\text{trunc}$ serves
as a structured contextual prior rather than a hard output filter.
```

**ANCHOR AFTER**
> The next sentence discussing the bond dimension $\chi$ or the MPS compression.

---

### A2 -- LLM model names

**ANCHOR BEFORE**
> Any sentence containing "Llama 4 Scout" or "Llama 4 Maverick" as the
> deployed model names.

**INSERT THIS (replace the model names in-place)**
```latex
% Change every occurrence of "Llama 4 Scout" to "meta.llama4-scout-17b-instruct-v1:0"
% and every occurrence of "Llama 4 Maverick" to "meta.llama4-maverick-17b-instruct-v1:0"
% Both are accessed via AWS Bedrock. Example corrected sentence:
The primary inference model is \texttt{meta.llama4-scout-17b-instruct-v1:0}
(accessed via AWS Bedrock), referred to throughout as \emph{Scout}.
The offline evaluation judge is \texttt{meta.llama4-maverick-17b-instruct-v1:0},
referred to as \emph{Maverick}.
```

**ANCHOR AFTER**
> The sentence describing the Bedrock API call structure or token limits.

---

### A3 -- ALS: mark as not implemented

**ANCHOR BEFORE**
> "Policy updates are performed using Alternating Least Squares (ALS), which
> provides a locally convex optimisation objective"
> (or similar sentence presenting ALS as the current update mechanism).

**INSERT THIS (replace/append after the ALS description)**
```latex
\emph{Note on implementation status:} The ALS-based policy sweep described
above is a \emph{planned} feature and has not yet been implemented.
The current system uses asynchronous advantage actor-critic (A3C) with
TD(0) critic updates and log-bias actor updates~\cite{mnih2016asynchronous}.
ALS is listed as a future-work item (see Section~\ref{sec:future}).
```

**ANCHOR AFTER**
> The next paragraph discussing the critic network or value function.

---

### A4 -- Partial trace: NotImplementedError

**ANCHOR BEFORE**
> "The partial trace over environment degrees of freedom yields the reduced
> density matrix $\rho_S$" (or similar sentence presenting partial trace
> as an implemented operation).

**INSERT THIS (append after the sentence)**
```latex
\emph{Note:} The partial trace operation is defined in the codebase
(\texttt{tensornets/agents/shared\_tensor\_state.py}) but raises
\texttt{NotImplementedError} at runtime; the full mixed-state formulation
is a planned extension.
The current implementation propagates a pure-state MPS without explicit
environment tracing.
```

**ANCHOR AFTER**
> The next sentence discussing the Lindblad master equation or the
> dissipation superoperator.

---

### A5 -- Gamma matrix: multi-component form

**ANCHOR BEFORE**
> Any sentence writing $\Gamma$ as a single scalar or a two-component sum
> (e.g.\ $\Gamma = \Gamma_\text{physio} + \Gamma_\text{habit}$).

**INSERT THIS (replace the Gamma definition with)**
```latex
The decay matrix $\Gamma$ is assembled from six additive components,
each representing a distinct physiological or psychosocial dissipation channel:
\begin{equation}
  \Gamma = \Gamma_\text{physio} + \Gamma_\text{habit}
           + \Gamma_\text{pkpd} + \Gamma_\text{reactivity}
           + \Gamma_\text{fear} + \Gamma_\text{companion}
\end{equation}
where $\Gamma_\text{physio}$ encodes autonomic stress,
$\Gamma_\text{habit}$ encodes behavioural inertia,
$\Gamma_\text{pkpd}$ encodes pharmacodynamic modulation (drug on board),
$\Gamma_\text{reactivity}$ encodes individual-difference reactivity archetype,
$\Gamma_\text{fear}$ encodes extinction-resistant fear hysteresis,
and $\Gamma_\text{companion}$ encodes the therapeutic alliance coupling
between agent and patient~\cite{safran2000negotiating}.
```

**ANCHOR AFTER**
> The sentence discussing the effective Hamiltonian $H_\text{eff} = H_0 - i\Gamma$.

---

### A6 -- Stress index: five-signal formula

**ANCHOR BEFORE**
> Any sentence defining the stress index using two or three signals
> (e.g.\ "stress is computed from HRV and EDA").

**INSERT THIS (replace with)**
```latex
The stress index $s \in [0,1]$ is computed as a weighted sum of five
physiological signals:
\begin{equation}
  s = w_1 \cdot \hat{\sigma}_\text{HRV} + w_2 \cdot \hat{\sigma}_\text{EDA}
    + w_3 \cdot \hat{\sigma}_\text{sleep} + w_4 \cdot \hat{\sigma}_\text{glucose}
    + w_5 \cdot \hat{\sigma}_\text{reactivity}
\end{equation}
where each $\hat{\sigma}$ is a min-max normalised signal and the weights
$(w_1,\ldots,w_5) = (0.35, 0.25, 0.20, 0.10, 0.10)$ are defined in
\texttt{tensornets/tensornets/physio/state.py}
(\texttt{DELTA\_SCALE = 0.15} controls the sensitivity of the OU increment).
```

**ANCHOR AFTER**
> The next sentence discussing the HysteresisGate or the five-zone dead-band.

---

## PART B -- New Content to Insert

---

### B1 -- New Section 2: Background and Preliminaries

Insert this entire new section AFTER the current Introduction (Section 1)
and BEFORE the current Section 2 (Architecture / System Overview).
All existing section numbers shift by +1.

**ANCHOR BEFORE (last sentence of Introduction)**
> "The remainder of this paper is structured as follows..." (or whatever
> the final sentence of Section 1 currently is).

**INSERT THIS**
```latex
\section{Background and Preliminaries}
\label{sec:background}

This section provides the theoretical foundations required to understand
the Hysteretic Tensor Negotiation (HTN) framework.
Readers familiar with all topics may skip to Section~\ref{sec:architecture}.

\subsection{Heart Rate Variability and the Autonomic Nervous System}
Heart rate variability (HRV) is the beat-to-beat fluctuation in the
R-R interval of the cardiac cycle.
High HRV is associated with parasympathetic dominance and emotional
flexibility; low HRV with sympathetic activation and rigid
coping~\cite{thayer2012heart}.
We model instantaneous HRV using an Ornstein-Uhlenbeck (OU) process~\cite{uhlenbeck1930brownian}:
\begin{equation}
  \mathrm{d}X_t = \theta(\mu - X_t)\,\mathrm{d}t + \sigma\,\mathrm{d}W_t
\end{equation}
where $\theta$ is the mean-reversion rate, $\mu$ the long-run mean HRV
(38\,ms at rest in the current implementation), $\sigma$ the volatility,
and $W_t$ a standard Wiener process.

\subsection{Matrix Product States}
A matrix product state (MPS) represents a quantum (or probabilistic)
state $|\psi\rangle$ over $n$ sites as a chain of tensors:
\begin{equation}
  |\psi\rangle = \sum_{s_1,\ldots,s_n} A^{s_1}_{[1]} A^{s_2}_{[2]}
                 \cdots A^{s_n}_{[n]} |s_1 \cdots s_n\rangle
\end{equation}
where each $A^{s_k}_{[k]}$ is a $\chi \times \chi$ matrix (or $1\times\chi$
/ $\chi\times 1$ at the boundaries) and $\chi$ is the \emph{bond dimension}
controlling expressivity~\cite{schollwock2011density,vidal2003efficient}.
MPS compression via singular value decomposition (SVD) truncates small
singular values, keeping only the $\chi_\text{trunc}$ largest.
In the HTN framework, the physiological state history is encoded as an MPS
over $T=10$ time steps with $\chi=4$, providing a compact fixed-size
representation that avoids KV-cache growth~\cite{stoudenmire2016supervised}.

\subsection{Monte Carlo Tree Search}
Monte Carlo Tree Search (MCTS) is a simulation-based planning algorithm
that builds a search tree through four repeated phases:
Selection (traverse tree via UCB1), Expansion (add a new child node),
Simulation (rollout to terminal), and Backpropagation (update node
statistics)~\cite{browne2012survey,silver2016mastering}.
In the HTN framework, MCTS is guided by the A3C Actor (prior over actions)
and Critic (value estimate), operating over a 22-action taxonomy.

\subsection{Asynchronous Advantage Actor-Critic (A3C)}
A3C~\cite{mnih2016asynchronous} maintains a shared global policy $\pi_\theta$
and value function $V_\phi$, updated asynchronously by multiple parallel
workers.
Each worker accumulates gradients over $t_\text{max}$ steps:
\begin{align}
  \nabla_\theta J &= \sum_t \nabla_\theta \log \pi_\theta(a_t|s_t)\,
                    A(s_t,a_t) \\
  A(s_t,a_t)     &= R_t - V_\phi(s_t)
\end{align}
where $R_t = \sum_{k=0}^{T-t} \gamma^k r_{t+k}$ is the discounted return
and $A$ is the advantage.

\subsection{Non-Hermitian Open Systems}
In open quantum systems, the effective Hamiltonian governing the
non-unitary evolution of the system subsystem $S$ is~\cite{rotter2009review}:
\begin{equation}
  H_\text{eff} = H_0 - i\Gamma
\end{equation}
where $H_0$ is the Hermitian (energy-conserving) part and $\Gamma \geq 0$
is the decay matrix encoding dissipation into the environment~\cite{moiseyev2011non}.
In the HTN framework, $\Gamma$ encodes the multiple channels through which
physiological and psychosocial state decays, and $H_0$ encodes the
therapeutic coupling between companion and patient.

\subsection{Hysteresis in Psychology}
Psychological hysteresis refers to the path-dependent resistance to
state change: a patient who has previously experienced a high-stress state
requires a lower trigger to re-enter it than a patient who has never
experienced it (fear conditioning)~\cite{bouton2004context,foa1986emotional}.
The Rescorla-Wagner model formalises this as a delta-rule update to
associative strength~\cite{rescorla1972theory}.
The HTN framework models this via the \texttt{HysteresisGate}:
a five-zone dead-band state machine with asymmetric transition thresholds
(entering a high-stress zone is easier than leaving it).
```

**ANCHOR AFTER (first sentence of the old Section 2, now Section 3)**
> "The system architecture consists of..." (or whatever opens the
> old Section 2).

---

### B2 -- New subsection: Care Circle Orchestration

Insert after the subsection describing the CompanionCoordinator
(currently in Section 3 or 4 of the PDF), before any benchmarking
or evaluation material.

**ANCHOR BEFORE**
> The last sentence of the CompanionCoordinator description, e.g.:
> "...the CompanionCoordinator aggregates the outputs of all handlers
> and forwards the enriched context to the response generator."

**INSERT THIS**
```latex
\subsection{Care Circle Orchestration}
\label{sec:care-circle}

The HTN framework operates within a multi-principal care environment
in which three role types interact: the \emph{patient} (primary user),
the \emph{caregiver} (family member or informal carer), and the
\emph{clinician} (doctor, therapist, or social worker).
Each role has a dedicated companion agent; cross-role communication is
mediated by the orchestration layer.

\subsubsection{Three-Layer Coordination Architecture}
Communication between principals flows through three layers:
\begin{enumerate}
  \item \textbf{Intra-companion layer}: \texttt{CompanionCoordinator.js}
        fans out to four parallel handlers (intent extraction, history
        analysis, empathy detection, state tracking) and merges results.
  \item \textbf{Inter-companion layer}: \texttt{orchestrator.js} operates
        as a system-level event bus, routing escalation events, future-plan
        completions, and confidential notifications between companions.
  \item \textbf{Confidential channel}: \texttt{CompanionConfidentialComm.js}
        allows peer companions to synchronise on fact conflicts and role
        transitions without exposing the raw message to other principals.
\end{enumerate}

\subsubsection{Consent Taxonomy}
Information sharing between principals is governed by four consent levels,
evaluated in real time by \texttt{privacyGuard.js} (an LLM-based classifier):
\begin{description}
  \item[NONE] Sharing is unconditionally blocked; no database write occurs.
  \item[LIMITED] A data subset (e.g.\ medication adherence only) may be shared;
        the decision is logged to the interventions table.
  \item[FULL] All information for the topic may be shared; logged as
        \texttt{consent\_granted/FULL}.
  \item[EMERGENCY] Bypasses normal consent checks; all information shared
        and logged as \texttt{consent\_emergency/EMERGENCY}.
\end{description}

\subsubsection{Escalation}
Escalation to clinical staff is triggered by two independent mechanisms
that can fire concurrently:
\begin{itemize}
  \item \textbf{Path A (MCTS-driven)}: when the FastAPI server returns
        \texttt{action: "escalate"} with \texttt{stress\_index} > 0.85,
        \texttt{CompanionCoordinator} delegates to \texttt{escalationManager.js}.
        Stress index > 0.90 triggers a HIGH escalation (immediate SSE
        broadcast to Doctor and Caregiver); 0.85--0.90 triggers MEDIUM
        (intervention queue write + broadcast to Doctor only).
  \item \textbf{Path B (future-plan-executed)}: when \texttt{orchestrator.js}
        receives a \texttt{future\_plan\_executed} event from
        \texttt{futurePlanningAgent.js}, it calls \texttt{db.addEscalation}
        directly and emits the same escalation event.
\end{itemize}

\subsubsection{Social Prior Matrix ($V_\text{int}$)}
The social coupling between principals is encoded in the prior matrix
$V_\text{int} \in \mathbb{R}^{n \times n}$ (where $n$ is the number of
circle members).
Initial priors in \texttt{shared\_tensor\_state.py} are:
\begin{equation}
  V_\text{int} = \begin{pmatrix}
    1.0 & 0.7 & 0.5 \\
    0.7 & 1.0 & 0.6 \\
    0.5 & 0.6 & 1.0
  \end{pmatrix}
\end{equation}
for the patient--caregiver--clinician triad.
The planned hysteretic extension (alliance persistence across sessions)
is not yet implemented; $V_\text{int}$ currently uses fixed priors.
```

**ANCHOR AFTER**
> The next subsection or section heading that follows the
> CompanionCoordinator description.

---

### B3 -- New Section: Empirical Benchmarking

Insert this as the new Section 5 (after the existing architecture/methods
sections and before any existing evaluation/results material).
If a Section 5 already exists, renumber it to Section 6.

**ANCHOR BEFORE (last sentence before the insertion point)**
> The last sentence of the existing Section 4 or whatever section
> immediately precedes evaluation. A safe anchor is the final sentence of
> the care circle section just inserted:
> "...V_int currently uses fixed priors."

**INSERT THIS**
```latex
\section{Empirical Benchmarking}
\label{sec:benchmarking}

\subsection{Experimental Design}
We evaluate the HTN framework against three baselines using a
capability-ladder design with eight experimental arms (Table~\ref{tab:arms}).
Each arm is an A3C worker trained independently on the same episode pool.

\begin{table}[h]
\centering
\caption{Eight-arm capability ladder. Arms are ordered by ascending
         architectural complexity. ``Inertial'' = inertial MPS encoding;
         ``HPVOOT'' = Hierarchical PWV-OOT MCTS variant;
         ``LLM+CoT+MCTS'' = LLM-guided chain-of-thought MCTS.}
\label{tab:arms}
\begin{tabular}{clcccc}
\hline
Exp & Arm identifier & Physio & Inertial & HPVOOT & CoT+MCTS \\
\hline
0 & \texttt{physio\_llm}                           & \ding{51} & & & \\
1 & \texttt{physio\_llm\_cot\_mcts}                & \ding{51} & & & \ding{51} \\
2 & \texttt{physio\_mps\_mcts}                     & \ding{51} & & & \\
3 & \texttt{inertial\_physio\_mps\_mcts}           & \ding{51} & \ding{51} & & \\
4 & \texttt{inertial\_physio\_llm\_cot\_mcts}      & \ding{51} & \ding{51} & & \ding{51} \\
5 & \texttt{oldschool} (baseline)                  & & & & \\
6 & \texttt{inertial\_hpvoot\_physio\_mps\_mcts}   & \ding{51} & \ding{51} & \ding{51} & \\
7 & \texttt{inertial\_hpvoot\_physio\_llm\_cot\_mcts} & \ding{51} & \ding{51} & \ding{51} & \ding{51} \\
\hline
\end{tabular}
\end{table}

\noindent Add \texttt{\textbackslash usepackage\{pifont\}} to your preamble for \ding{51}.

\subsection{POMDP-H Formulation}
Each training episode is a POMDP with hysteresis (POMDP-H):
\begin{equation}
  \langle \mathcal{S}, \mathcal{A}, \mathcal{T}, \mathcal{R}, \Omega, \mathcal{O}, \gamma, \mathcal{H} \rangle
\end{equation}
where $\mathcal{H}$ is the hysteresis memory (encoded as an MPS over the
last $T=10$ turns), $\Omega$ is the observation space (patient utterances),
and $\mathcal{O}$ is the emission model (Scout LLM).
The action space $|\mathcal{A}| = 22$ covers the full motivational
interviewing and clinical communication taxonomy defined in
\texttt{tensornets/tensornets/a3c/arms.py}.

\subsection{Reward Function}
The per-turn reward $r_t$ is a composite of three components:
\begin{equation}
  r_t = r_\text{progress} + r_\text{stress} + r_\text{trust}
\end{equation}
\begin{align}
  r_\text{progress} &= \Delta\,\texttt{info\_coverage} \cdot \texttt{PROGRESS\_WEIGHT} \\
  r_\text{stress}   &= -s_t \cdot \texttt{STRESS\_WEIGHT} \\
  r_\text{trust}    &= \Delta\,\texttt{trust} \cdot \texttt{TRUST\_WEIGHT}
\end{align}
where $s_t$ is the physiological stress index (Section~\ref{sec:background}),
and the weights are \texttt{PROGRESS\_WEIGHT}=1.5, \texttt{STRESS\_WEIGHT}=0.3,
\texttt{TRUST\_WEIGHT}=0.5 (defined in \texttt{arms.py}).
Episodic goal achievement is additionally scored by the Maverick LLM judge,
producing a \texttt{goal\_progress} scalar in $[0,1]$.

\subsection{Research Questions}
\begin{description}
  \item[RQ1] Does the physiological layer (MPS + HysteresisGate + A3C)
        yield higher clinical goal achievement than the production
        rule-based baseline (\texttt{oldschool})?
  \item[RQ2] Does inertial MPS encoding (modelling physiological history
        across sessions) improve over single-session MPS encoding?
  \item[RQ3] Does HPVOOT planning provide additional benefit over
        standard MCTS, controlling for the physio and inertial layers?
  \item[RQ4] What is the reward efficiency (goal achievement per unit of
        computational complexity) of each arm?
  \item[RQ5] Are the performance gains robust across different patient
        archetypes (standard, anxious, stoic) and clinical scenario types?
\end{description}

\subsection{Null Hypotheses and Rejection Criteria}
The confirmatory analysis pre-registers the following null hypotheses:

\begin{table}[h]
\centering
\caption{Pre-registered null hypotheses and rejection criteria.}
\label{tab:hypotheses}
\begin{tabular}{lp{5cm}p{3cm}c}
\hline
ID & $H_0$ & Test & Threshold \\
\hline
H\textsubscript{0,1} &
  Goal-achieved rate: physio arms $\leq$ \texttt{oldschool} &
  McNemar (paired by scenario) &
  $p < 0.05$, OR $\geq 1.5$ \\
H\textsubscript{0,2} &
  Mean \texttt{change\_stage\_delta}: physio arms $\leq$ \texttt{oldschool} &
  Wilcoxon signed-rank &
  $p < 0.05$ \\
H\textsubscript{0,3} &
  Inertial arms $\leq$ non-inertial physio arms (goal rate) &
  McNemar &
  $p < 0.05$ \\
H\textsubscript{0,4} &
  HPVOOT arms $\leq$ non-HPVOOT inertial arms (goal rate) &
  McNemar &
  $p < 0.05$ \\
\hline
\end{tabular}
\end{table}

Multiple comparisons are corrected with the Benjamini-Hochberg
procedure at FDR = 0.10~\cite{benjamini1995controlling}.
Effect sizes are reported as Cohen's $h$ (binary outcomes) and Cohen's $d$
(continuous outcomes)~\cite{cohen1988statistical}.
A minimum effect size of OR = 1.5 ($h \approx 0.20$) is required for
the result to be considered practically significant.

\subsection{run\_018 Results (Preliminary)}
Table~\ref{tab:run018} reports per-arm completion statistics from
\texttt{run\_018} ($\sim$500 episodes per arm, LLM-patient mode,
2026-06-01 to 2026-06-02).

\begin{table}[h]
\centering
\caption{run\_018 per-arm completion statistics.
         ``Success rate'' = episodes completing without worker crash /
         total episodes; this is a preliminary completion metric.
         Per-episode \texttt{goal\_progress} (Maverick LLM judge)
         analysis is pending.}
\label{tab:run018}
\begin{tabular}{clrrr}
\hline
Exp & Arm & Episodes & Successful & Rate \\
\hline
0 & \texttt{physio\_llm}                           & 561 & 214 & 38.1\% \\
1 & \texttt{physio\_llm\_cot\_mcts}                & 500 & 193 & 38.6\% \\
2 & \texttt{physio\_mps\_mcts}                     & 541 & 191 & 35.3\% \\
3 & \texttt{inertial\_physio\_mps\_mcts}           & 551 & 203 & 36.8\% \\
4 & \texttt{inertial\_physio\_llm\_cot\_mcts}      & 551 & 200 & 36.3\% \\
5 & \texttt{oldschool} (baseline)                  & 541 & 149 & 27.5\% \\
6 & \texttt{inertial\_hpvoot\_physio\_mps\_mcts}   & 551 & 205 & 37.2\% \\
7 & \texttt{inertial\_hpvoot\_physio\_llm\_cot\_mcts} & 531 & 87 & 16.4\%$^\dagger$ \\
\hline
\multicolumn{5}{l}{$\dagger$ Anomalously low; see text.}
\end{tabular}
\end{table}

All physio-equipped arms (Exp~0--4, 6) show a completion rate of
35--39\%, compared to 27.5\% for the \texttt{oldschool} baseline,
a gap of approximately 10 percentage points consistent with the
pilot run\_013 finding (11.6~pp goal\_achieved\% gap,
Section~\ref{sec:run013}).
Experiment 7 (\texttt{inertial\_hpvoot\_physio\_llm\_cot\_mcts}) shows
an anomalously low rate (16.4\%) with a latest actor checkpoint at
step 100 (vs.\ 500+ for all other arms), suggesting a training
instability that requires further investigation.
```

**ANCHOR AFTER**
> The heading of the next section (old Section 5, now Section 6) which
> should be Discussion or Future Work.

---

### B4 -- Implementation Status Table

Insert this as a subsection within the Architecture section
(old Section 2, new Section 3 after the Background chapter),
at the end of the architecture description.

**ANCHOR BEFORE**
> The last paragraph of the architecture section, e.g.:
> "...the system is deployed on a Node.js/Express server communicating
> with a FastAPI Python inference server."

**INSERT THIS**
```latex
\subsection{Implementation Status}
\label{sec:impl-status}

Table~\ref{tab:impl} distinguishes features that are implemented and
active in \texttt{run\_018} from planned features described elsewhere
in this paper.

\begin{table}[h]
\centering
\caption{Implementation status of key HTN components as of run\_018
         (June 2026).}
\label{tab:impl}
\begin{tabular}{p{4.5cm}lp{5cm}}
\hline
Feature & Status & Notes \\
\hline
MPS physiological encoding & \textbf{Live} & $\chi=4$, $T=10$ turns \\
HysteresisGate (5-zone) & \textbf{Live} & \texttt{physio/hysteresis.py} \\
A3C actor-critic & \textbf{Live} & 8 parallel arms, TD(0) updates \\
MCTS with Actor/Critic prior & \textbf{Live} & 22-action taxonomy \\
HPVOOT MCTS variant & \textbf{Live} & Exp 6 \& 7 only \\
OU physiological model & \textbf{Live} & HRV, EDA, sleep, glucose \\
PK/PD drug regimen model & \textbf{Live} & One-compartment + E-max Hill \\
LLM-as-judge (Maverick) & \textbf{Live} & Real-time + offline scoring \\
Thompson sampling warm-up & \textbf{Live} & Pre-A3C exploration phase \\
Inertial MPS encoding & \textbf{Live} & Exp 3, 4, 6, 7 \\
Care circle orchestration & \textbf{Live} & JS layer; 3-principal model \\
Partial trace ($\rho_S$) & \textbf{Planned} & \texttt{NotImplementedError} \\
ALS policy sweep & \textbf{Planned} & \texttt{core/als.py} not yet built \\
Tensor RAG & \textbf{Planned} & Current: SQLite decay RAG \\
Hysteretic $V_\text{int}$ & \textbf{Planned} & Fixed priors in current code \\
HITL feedback loop & \textbf{Planned} & Annotation infra exists, unwired \\
\hline
\end{tabular}
\end{table}
```

**ANCHOR AFTER**
> The heading of the next subsection or the benchmarking section.

---

## PART C -- Missing Figures

Each figure below should be added at the location indicated.
All captions include an academic reference where applicable.

---

### Fig 1 -- Physiological hysteresis time course

**Insert after**: the HysteresisGate description (inside the
physio-model subsection).

```latex
\begin{figure}[h]
\centering
% Replace with your TikZ/pgfplots plot or import as PDF
\includegraphics[width=0.8\linewidth]{fig_hysteresis_timecourse}
\caption{Simulated HRV time course showing hysteretic behaviour.
  The solid line shows a stressor event at $t=5$\,min driving HRV below
  the lower dead-band threshold; recovery follows a slower trajectory
  (asymmetric OU reversion) back through the upper threshold.
  Compare with empirical WESAD wearable data~\cite{schmidt2018introducing}.}
\label{fig:hysteresis}
\end{figure}
```

---

### Fig 2 -- MPS bond dimension scaling

**Insert after**: the MPS foundations paragraph in Section 2.2.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.75\linewidth]{fig_mps_bond_dim}
\caption{Approximation error (Frobenius norm of $|\psi\rangle -
  |\psi_\chi\rangle$) as a function of bond dimension $\chi$ for a
  10-site physiological state chain.
  The current implementation uses $\chi=4$ (dashed line), balancing
  expressivity and computational cost.
  Theory: $\chi^*$ minimising error subject to $\mathcal{O}(\chi^2)$
  contraction cost~\cite{schollwock2011density}.}
\label{fig:mps-bond}
\end{figure}
```

---

### Fig 3 -- H_eff decomposition

**Insert after**: the $H_\text{eff} = H_0 - i\Gamma$ equation.

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.85\linewidth]{fig_heff_decomp}
\caption{Decomposition of the effective Hamiltonian $H_\text{eff}$
  into the Hermitian coupling $H_0$ (therapeutic interaction) and the
  anti-Hermitian decay matrix $\Gamma$ (six additive dissipation channels).
  Non-Hermitian formalism after~\cite{rotter2009review}.}
\label{fig:heff}
\end{figure}
```

---

### Fig 4 -- MCTS four-phase loop

**Insert after**: the MCTS preliminaries paragraph (Section 2.3).

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.9\linewidth]{fig_mcts_loop}
\caption{MCTS four-phase loop as implemented in the HTN framework.
  The Actor provides the prior $\pi(a|s)$ during Selection (UCB1 + prior);
  the Critic provides the value $V(s)$ during Backpropagation.
  After~\cite{browne2012survey,silver2016mastering}.}
\label{fig:mcts}
\end{figure}
```

---

### Fig 5 -- Care circle three-layer architecture

**Insert after**: the care circle orchestration subsection
(Section 3.x or 4.x on care circle).

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.95\linewidth]{fig_care_circle}
\caption{Three-layer coordination architecture for the care circle.
  Layer 1 (intra-companion): \texttt{CompanionCoordinator.js} parallel
  handler fan-out.
  Layer 2 (inter-companion): \texttt{orchestrator.js} event bus and
  SSE broadcast.
  Layer 3 (confidential): \texttt{CompanionConfidentialComm.js} peer
  notification channel.}
\label{fig:care-circle}
\end{figure}
```

---

### Fig 6 -- 8-experiment capability ladder

**Insert at the start of the Benchmarking section (before Table~\ref{tab:arms}).**

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.9\linewidth]{fig_capability_ladder}
\caption{Eight-arm capability ladder showing progressive addition of
  architectural components (physio layer, inertial MPS, HPVOOT, LLM+CoT).
  Each step represents an independent A3C training arm.
  The \texttt{oldschool} arm (Exp 5) is the production rule-based baseline.}
\label{fig:ladder}
\end{figure}
```

---

### Fig 7 -- POMDP-H state diagram

**Insert inside the POMDP-H formulation subsection.**

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.8\linewidth]{fig_pomdp_states}
\caption{POMDP-H state diagram showing the five HysteresisGate zones
  (very-low, low, medium, high, very-high stress) with asymmetric
  transition thresholds.
  Observations $o \in \Omega$ are patient utterances; actions
  $a \in \mathcal{A}$ are the 22-item motivational interviewing taxonomy.
  After~\cite{kaelbling1998planning}.}
\label{fig:pomdp}
\end{figure}
```

---

### Fig 8 -- run_018 per-arm completion rates

**Insert inside the run\_018 results subsection, after Table~\ref{tab:run018}.**

```latex
\begin{figure}[h]
\centering
\includegraphics[width=0.85\linewidth]{fig_run018_rates}
\caption{Per-arm episode completion rates for \texttt{run\_018}
  ($\sim$500 episodes per arm, LLM-patient mode).
  All physio-equipped arms (Exp~0--4, 6) exceed the \texttt{oldschool}
  baseline (Exp~5) by approximately 10 percentage points.
  Experiment 7 is an anomaly under investigation (checkpoint divergence
  at step 100).}
\label{fig:run018}
\end{figure}
```

---

## PART D -- Consistency Fixes (global search-and-replace)

Apply these globally across the entire `.tex` source.

| Find | Replace with | Reason |
|------|-------------|--------|
| `Llama 4 Scout` | `\texttt{meta.llama4-scout-17b-instruct-v1:0} (Scout)` | Correct model name |
| `Llama 4 Maverick` | `\texttt{meta.llama4-maverick-17b-instruct-v1:0} (Maverick)` | Correct model name |
| `\Gamma` (single component) | See A5 above | Multi-component form |
| `5 stress buckets` or `5 zones` | `five-zone HysteresisGate dead-band` | Consistent terminology |
| `ALS optimizer` / `ALS update` | append `(planned; not yet implemented)` | Accuracy |
| `Partial Trace` (as implemented) | append `(planned; raises \texttt{NotImplementedError})` | Accuracy |
| bare `[X]` citation style | `\cite{key}` with key from `references.bib` | BibTeX consistency |

---

## PART E -- Continuity Fixes

### E1 -- Transition from Background to Architecture

**After the last paragraph of Section 2 (Background), before Section 3 header:**

```latex
Having established the mathematical foundations, we now describe how
these components are integrated in the HTN system architecture.
The physiological model (Section~\ref{sec:background}.1--2) provides
the state signal; the MPS encodes that signal compactly
(Section~\ref{sec:background}.2); the MCTS plans over it
(Section~\ref{sec:background}.3); and the A3C trains the planning
policy end-to-end (Section~\ref{sec:background}.4).
The non-Hermitian formalism (Section~\ref{sec:background}.5) unifies
all dissipation effects into a single operator $\Gamma$.
```

### E2 -- Transition from Architecture to Benchmarking

**After the last sentence of the Architecture section, before the Benchmarking section:**

```latex
The architecture described above is evaluated empirically in
Section~\ref{sec:benchmarking} using an eight-arm capability ladder
that progressively adds each component to isolate its contribution.
```

### E3 -- Related Work subsection (add inside Background section)

**After Section 2.6 (Hysteresis in Psychology), before end of Background:**

```latex
\subsection{Related Work}
\label{sec:related}
Tensor network methods have been applied to supervised learning by
\citet{stoudenmire2016supervised}, who demonstrated that MPS can
classify MNIST digits with competitive accuracy, establishing that
tensor decompositions are viable for machine learning beyond physics.
Reinforcement learning for dialogue has been studied extensively;
\citet{kaelbling1998planning} formalised the POMDP framework that
underlies most task-oriented dialogue systems.
The application of non-Hermitian operators to \emph{psychological}
modelling is, to the best of our knowledge, novel to this work.
Prior approaches to physiological state modelling in mental health
chatbots have used rule-based thresholds~\cite{miller2012motivational}
or simple sliding-window averages; the OU-process formulation with
hysteretic gating provides a more principled dynamic model.
```

### E4 -- Conclusion section (add at end of paper)

**After the last section (Future Work / Discussion), as the final section:**

```latex
\section{Conclusion}
\label{sec:conclusion}

This paper has presented the Hysteretic Tensor Negotiation (HTN)
framework, a novel architecture for physiologically-aware mental health
companion systems.
The key contributions are:
(1) a non-Hermitian operator formulation that unifies six physiological
and psychosocial dissipation channels into a single $\Gamma$ matrix;
(2) an MPS-based physiological state encoding that provides a
fixed-size longitudinal representation without KV-cache growth;
(3) an MCTS planning layer guided by an A3C actor-critic,
operating over a 22-action clinical communication taxonomy;
and (4) a three-layer care circle orchestration architecture supporting
multi-principal consent management and escalation.
Preliminary results from \texttt{run\_018} (8 arms, $\sim$500 episodes
each) show that all physio-equipped arms exceed the production
rule-based baseline by approximately 10 percentage points on episode
completion rate, consistent with the pilot run\_013 finding.
Confirmatory analysis with per-episode Maverick LLM judge scores and
genuine metrics (\texttt{change\_stage\_delta}, \texttt{stress\_auc})
is ongoing.
```

---

## Preamble additions required

Add these lines to your `.tex` preamble if not already present:

```latex
\usepackage{pifont}          % for \ding{51} checkmarks in tables
\usepackage{booktabs}        % for \toprule, \midrule, \bottomrule in tables
\usepackage{natbib}          % for \citet, \citep author-year citations
\bibliographystyle{plainnat} % or apalike, ieeetr, etc.
\bibliography{references}    % at the end of the document
```

---

*End of insertion guide. Total new content: ~1 new section (Background),
1 new subsection (Care Circle), 1 new section (Benchmarking),
1 new subsection (Implementation Status), 8 new figures,
1 Related Work subsection, 1 Conclusion section.*
