SYSTEM ROLE: System Architect

DO NOT modify existing systems unless explicitly required.

---

# MARKET SYSTEM — FINAL SPEC

## CONTEXT

The application includes:

- Portfolio system
- Dashboard UI
- Monster interaction system
- Message system

Limitation:
No external market awareness.

---

## GOAL

Create an independent Market System that:

1. Fetches market data
2. Converts it into signals
3. Returns structured output for other systems

---

## CORE PRINCIPLE

Strict separation:

- Market → signals only
- Portfolio → user state
- Insight Engine → combination
- Monster → communication

NO overlap allowed.

---

## RESPONSIBILITY

The Market System MUST:

1. Fetch BTC market data
2. Normalize values
3. Generate signals

---

## DATA SOURCE

https://demo-provider.invalid/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true

---

## FUNCTION

async function getMarketSignals()

---

## OUTPUT

{
  trend: "up" | "down" | "neutral",
  volatility: "low" | "medium" | "high",
  momentum: "weak" | "strong"
}

---

## CONSTRAINTS

- NO UI
- NO DOM
- NO portfolio logic

---

END


