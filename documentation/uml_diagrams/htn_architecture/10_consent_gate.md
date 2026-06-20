# Consent and Privacy Gate

**Scale:** Component level
**One idea:** How a single piece of information is classified and then gated before leaving a companion

```mermaid
flowchart TD
    CONTENT(["Response content\n(or shared fact)"])

    subgraph PRIVACY["privacyGuard.js  (stateless LLM classifier)"]
        CLASSIFY{"Classify\ncontent"}
        PUB["public\n(no restriction)"]
        PRIV["private\n(user-only)"]
        SENS["sensitive\n(restricted sharing)"]
    end

    subgraph CONSENT["consentManager.js  (stateful DB gate)"]
        TIER_CHECK{"Consent tier\ncheck"}
        EMG["Emergency override\nbypasses ALL gates\n(life-threatening context)"]
        IMPLIED["Implied consent\ngetImpliedConsent\n(userId, circleId, topic)"]
        EXPLICIT["Explicit consent\ncircle_members.consent_level\nnone | limited | full"]
    end

    ALLOW(["✓ Allow\nshare / send"])
    DENY(["✗ Deny\nredact / block"])
    ANON(["~ Anonymise\nshare without identifying details"])

    CONTENT --> CLASSIFY
    CLASSIFY --> PUB & PRIV & SENS

    PUB --> ALLOW
    PRIV --> TIER_CHECK
    SENS --> TIER_CHECK

    TIER_CHECK --> EMG --> ALLOW
    TIER_CHECK --> IMPLIED
    TIER_CHECK --> EXPLICIT
    IMPLIED -- "consent found" --> ALLOW
    IMPLIED -- "no consent" --> DENY
    EXPLICIT -- "full" --> ALLOW
    EXPLICIT -- "limited" --> ANON
    EXPLICIT -- "none" --> DENY
```

## Three confidentiality channel levels

```mermaid
flowchart LR
    MSG(["Message / fact"])

    C1["companion_only\noriginating companion only\n(no sharing)"]
    C2["companion_network\nall companions for\nthe same user\nacross circles"]
    C3["cross_user\ncompanions of other users\n(intra-circle coordination)"]

    MSG --> C1
    MSG --> C2
    MSG --> C3
```

## How privacyGuard and consentManager differ

| Property | privacyGuard.js | consentManager.js |
|---|---|---|
| State | Stateless — each call is independent | Stateful — reads/writes DB per decision |
| Method | LLM classifier (single API call) | Rule-based tier lookup against DB schema |
| Output | Classification label: public / private / sensitive | Binary: allow / deny / anonymise |
| Runs | Once per response, pre-send screen | Once per sharing decision (escalation, fact sync, cross-circle) |
| Can be bypassed | No | Yes — emergency override bypasses all tiers |
