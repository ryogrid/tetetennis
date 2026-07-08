// Mock Host for headless CPU-vs-CPU runs (autotune_design/04-headless-runner.md).
// render/audio/camera are Proxies (host_sfx dispatches dynamically, so
// enumerating method names is fragile); ui intercepts showResults to signal
// match completion. The input object is written out explicitly as
// documentation of the pull surface — in CPU mode the logic never consults it.

export function makeHost(state) {
  const noop = new Proxy({}, { get: () => () => 0 });
  return {
    render: noop,
    audio: noop,
    camera: noop,
    ui: new Proxy({}, {
      get: (_, name) =>
        name === 'showResults' ? () => { state.done = true; } : () => 0,
    }),
    input: {
      moveX: () => 0,
      moveZ: () => 0,
      shotKey: () => '',
      shotHeld: () => '',
      wasPressed: () => false,
      isDown: () => false,
      touchStroke: () => '', // String externs (host_touch_stroke)
      touchServe: () => '',
      haptic: () => {},
    },
    loadAssist: () => 'off',
    saveAssist: () => {},
    onMatchStart: () => {},
    onPointHighlight: () => {},
    onTension: () => {},
    onPointSituation: () => {},
    onCrowdReact: () => {},
  };
}
