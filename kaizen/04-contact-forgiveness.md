# Kaizen 04 — Contact Forgiveness

These proposals tune the **contact-quality model** so that imperfect contact is
less harshly punished. They are the "make the margins wider" complement to the
feedback aids in `02`/`03`: even with better cues, a beginner will be off-center
often, and right now that silently tanks their shot. All values below are
suggestions to be confirmed by playtest, and most are best applied **only under
Easy / Assist Mode** so Normal/Hard keep their current feel.

Reference — current contact model (`src/game/shots.js:35-104`):

```js
// distance bands around IDEAL_CONTACT_R = 0.65
const lo = IDEAL_CONTACT_R - 0.35, hi = IDEAL_CONTACT_R + 0.25;   // 0.30 .. 0.90
// height falloff around IDEAL_CONTACT_H (waist ~0.85)
const qHeight = 1 - clamp((Math.abs(h - IDEAL_CONTACT_H) - 0.3) / 0.9, 0, 0.55);
// incoming-speed penalty
const qSpeed = clamp(1 - (vIn - 18) / 55, 0.65, 1);
// q < 0.3 -> 35% mishit chance; speed = flatSpeed*(0.52 + 0.48*q)
```

---

## 4.1 Widen the quality bands

### Problem
The "perfect contact" window is narrow: the flat distance band is only
`0.30–0.90 m` and the height band ±0.3 m before falloff. Just outside it, power,
spin, and depth all drop together, so a near-miss feels like a random weak shot.

### Proposal
Under Easy/Assist, **widen the forgiving bands** so off-center contact still
produces a solid ball:
- Distance: widen `hi` (e.g. `IDEAL_CONTACT_R + 0.25` → `+0.40`) and/or raise the
  cramped-contact floor (`qDist = 0.55 + ...` → start higher).
- Height: extend the flat region before falloff (the `-0.3` term → `-0.45`) and/or
  reduce the max penalty (`0.55` cap → `0.40`).

### Implementation pointers
- `contactQuality()` distance bands: `src/game/shots.js:45-49`.
- Height term: `src/game/shots.js:51`.
- Make the band constants read from an assist-scaled source rather than literals so
  Normal/Hard stay exactly as today.

### Effort / Impact
Low effort, medium impact. A few constants, big change in "why was that weak" frustration.

### Risks
- Widen too far and positioning stops mattering; keep Normal/Hard untouched.

---

## 4.2 Soften mishit chance and velocity penalty

### Problem
Two things make fast balls especially punishing for beginners:
1. The **mishit roll**: at `q < 0.3` there's a 35% chance of a mishit
   (speed → 55%, spin → 30%), which feels like the game randomly threw the point.
2. The **velocity penalty** `qSpeed`: fast incoming balls cap `q` at `0.65`, so the
   exact shots a beginner struggles to reach also auto-degrade their return.

### Proposal
Under Easy/Assist:
- Lower the **mishit probability** (35% → e.g. 15%) and/or soften its severity.
- Raise the **`qSpeed` floor** (0.65 → e.g. 0.80) so fast balls don't compound the
  difficulty by also wrecking contact quality.

### Implementation pointers
- Mishit roll and speed/spin scaling: `src/game/shots.js` ~lines 84-104.
- Velocity penalty: `src/game/shots.js:53` (`qSpeed` clamp).
- Gate both behind the assist flag.

### Effort / Impact
Low effort, medium impact. Removes the "random bad luck" feel and the
fast-ball double-penalty.

### Risks
- Reducing mishits removes some of the texture that makes good positioning
  rewarding; keep it Easy/Assist-only.

---

## 4.3 Assist-scaled reach

### Problem
Even with a `1.5×` reach already applied (`src/physics/constants.js:86`), the strike
zone can still feel small to a new player who is slightly out of position.

### Proposal
Add a further **reach bump under Assist Mode** (e.g. an extra `1.15×–1.25×` on top
of the existing `1.5×`), enlarging the effective strike zone and the reach-zone
circle the player sees. This is the lowest-risk forgiveness lever because the
visual (reach circle) updates automatically and honestly reflects the new range.

### Implementation pointers
- `reach: (REA) => (1.25 + 0.25*REA/100) * 1.5` (`src/physics/constants.js:86`).
  Add an assist factor to this multiplier (via the same runtime-settable mechanism
  suggested for pace in `01.1`).
- The reach-zone circle (`src/entities/player.js:291-312`) is already sized from
  this value, so it stays truthful with no extra UI work.
- `hMax` (vertical ceiling) is derived from reach (`shots.js:40`), so this also
  slightly raises the reachable height — usually desirable.

### Effort / Impact
Low effort, medium impact. Honest (the indicator matches), and self-consistent.

### Risks
- Large reach can make the player feel like they're hitting balls they "shouldn't,"
  which looks odd given the stick-figure arm length; keep the bump modest.
