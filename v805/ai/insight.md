SYSTEM ROLE: System Architect

DO NOT modify existing systems unless explicitly required.

---

# INSIGHT ENGINE — FINAL SPEC

## CONTEXT

The system already has:

- Portfolio System → user state
- Market System → external signals

Missing:

A layer that interprets both.

---

## GOAL

Create an Insight Engine that:

1. Combines market signals + portfolio data
2. Generates clear insights
3. Returns structured output for Monster

---

## CORE PRINCIPLE

Strict separation:

- Market → signals only
- Portfolio → data only
- Insight → interpretation
- Monster → communication

---

## INPUTS

From Market:

{
  trend: "up" | "down" | "neutral",
  volatility: "low" | "medium" | "high",
  momentum: "weak" | "strong"
}

From Portfolio:

{
  cryptoExposure: number,
  liquidity: number
}

---

## OUTPUT

{
  type: string,
  message: string,
  severity: "low" | "medium" | "high"
}

---

## RULES

- Deterministic logic only
- No randomness
- No UI
- No external calls

---

END
