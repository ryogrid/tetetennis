// 5 playable characters. Stats 0-100:
// POW groundstroke power, SPN topspin rate, SLC slice quality, SRV serve,
// SPD movement, CTL control/consistency, REA reach & serve contact height.
//
// MUST stay in the same order as the MoonBit character list (boom, rojo, dash,
// sly, ace): the menu/host APIs key into this table by index. Copied verbatim
// from old/src/characters.js. Used by ui.js (card display) and render-host.js
// (rig colour + reach radius).
export const CHARACTERS = [
  {
    id: 'boom', name: 'Boom', archetype: 'Big Server', color: 0xd84a3a,
    desc: 'Huge serve and heavy flat strokes. Slow feet, shaky control.',
    style: 'server',
    stats: { POW: 85, SPN: 45, SLC: 50, SRV: 96, SPD: 55, CTL: 58, REA: 88 },
  },
  {
    id: 'rojo', name: 'Rojo', archetype: 'Spin Grinder', color: 0xe07b2a,
    desc: 'Brutal topspin that kicks high, especially on clay. Modest serve.',
    style: 'grinder',
    stats: { POW: 74, SPN: 96, SLC: 55, SRV: 62, SPD: 82, CTL: 70, REA: 60 },
  },
  {
    id: 'dash', name: 'Dash', archetype: 'Counterpuncher', color: 0x3aa0d8,
    desc: 'Fastest on tour with laser control. Lacks raw power.',
    style: 'counter',
    stats: { POW: 55, SPN: 65, SLC: 60, SRV: 50, SPD: 96, CTL: 88, REA: 55 },
  },
  {
    id: 'sly', name: 'Sly', archetype: 'Slice Specialist', color: 0x9b59b6,
    desc: 'Knifing slices that skid low on grass. Weak topspin game.',
    style: 'slicer',
    stats: { POW: 60, SPN: 38, SLC: 95, SRV: 74, SPD: 72, CTL: 80, REA: 70 },
  },
  {
    id: 'ace', name: 'Ace', archetype: 'All-Rounder', color: 0x2ecc71,
    desc: 'No weaknesses, no superweapon. Solid everywhere.',
    style: 'allround',
    stats: { POW: 74, SPN: 72, SLC: 70, SRV: 74, SPD: 74, CTL: 74, REA: 70 },
  },
];

// REA stat -> horizontal reach radius (m). Mirrors the MoonBit
// STATS_MAP.reach: (1.25 + 0.25 * REA/100) * 1.5. Only used for the human
// reach-zone circle visual.
export function reachRadius(REA) {
  return (1.25 + 0.25 * REA / 100) * 1.5;
}
