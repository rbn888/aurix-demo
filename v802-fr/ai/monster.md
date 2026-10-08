# MONSTER SYSTEM

## PURPOSE

The monster explains the user's portfolio in a simple, continuous and contextual way.

It must feel alive, relevant, and directly connected to the user's data.

---

## SYSTEM COMPONENTS

1. Movement (Engine)
- runs continuously using a single requestAnimationFrame loop
- never stops or freezes
- must be the only animation system controlling the monster

2. Messages
- generated from real portfolio data
- must prioritize meaningful insights (value, changes, distribution)
- avoid generic or random text

3. Queue System
- maintains a list of upcoming messages
- prevents repetition
- ensures smooth rotation between insights

4. Display System
- shows one message at a time
- transitions smoothly between messages
- no overlapping or flickering text

5. Flow Controller (CRITICAL)
- orchestrates when messages are generated and displayed
- ensures consistent timing and rhythm
- prevents conflicts between systems

---

## RULES (CRITICAL)

- Only ONE animation loop is allowed
- No duplicate movement systems
- No multiple transforms from different sources
- No uncontrolled randomness
- No duplicated message generation

### SYSTEM ISOLATION

- Movement cannot modify messages
- Messages cannot control animation
- Display cannot generate data
- Each system has a single responsibility

---

## PRIORITY

1. Real portfolio insights (highest priority)
2. Context-aware messages
3. Ambient messages (only if no data is available)

---

## VALIDATION

- monster always moves smoothly
- messages are readable and relevant
- no duplicated messages
- no UI glitches or overlap
- system remains stable over time

---

## GOAL

The user should feel:

"This system understands my portfolio and explains it to me in real time"
