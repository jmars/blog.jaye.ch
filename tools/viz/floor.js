/**
 * tools/viz/floor.js — W4, the floor (what-actually-works §1–§2).
 *
 * Set the system at the collapsed fixed point and engage a fixed floor. The
 * published result is a step, not a dose–response: below the critical value
 * nothing happens at all, and above it every value rescues *identically*.
 * The second panel shows the escape itself; the third shows the sharper
 * finding — a floor you keep re-checking cancels itself.
 *
 * SCHEMATIC. Published landmarks (§1–§2):
 *   collapsed G = 0.049, escape to G = 0.8855 in ~22 t.u.
 *   floors 0.0–0.4 all fail; 0.5 / 0.6 / 0.7 / 0.9 / 1.0 / 1.2 all escape identically
 *   critical floor 0.4795 — the collapsed state's own error E* = 0.4969
 *   knowing floor: floor held at 0.7, re-checked at c_mon = 0.1 / 0.2 / 0.3 / 0.5
 *   degrades G_end to 0.53 / 0.34 / 0.24 / 0.16; knowing-floor critical kc ≈ 0.2
 * The shape of the escape ramp is schematic; it is anchored to complete exactly
 * at the published ~22 t.u.
 */
VIZ.registerViz('floor', (function () {
  'use strict';

  var G_COL = 0.049;
  var G_HEALTHY = 0.8855;
  var FLOOR_CRIT = 0.4795;
  var E_STAR = 0.4969;
  var ESCAPE = 22;
  var ESCAPE_TAU = ESCAPE / 4; // the ramp completes at the published ~22 t.u.
  var KC = 0.2;
  var T_END = 60;
  // the knowing-floor measurement (floor held at 0.7, ungated re-checking)
  var KNOWING = [
    [0.1, 0.53],
    [0.2, 0.34],
    [0.3, 0.24],
    [0.5, 0.16],
  ];

  /** Fraction of the way out of the collapsed state at time t. */
  function ramp(t) {
    if (t >= ESCAPE) return 1;
    return (1 - Math.exp(-t / ESCAPE_TAU)) / (1 - Math.exp(-ESCAPE / ESCAPE_TAU));
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var stepCanvas = bag.node('canvas', 'viz-canvas');
    var traceCanvas = bag.node('canvas', 'viz-canvas');
    var knowingCanvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var floorSlider = VIZ.slider({
      label: 'floor value',
      min: 0,
      max: 1.2,
      step: 0.005,
      value: 0.7,
      digits: 3,
      onInput: draw,
    });
    controls.appendChild(floorSlider.el);

    function draw() {
      var floor = floorSlider.value();
      var escapes = floor >= FLOOR_CRIT;
      var end = escapes ? G_HEALTHY : G_COL;

      /* --- the step: outcome as a function of the floor --- */
      var f = VIZ.frame(stepCanvas, {
        height: 240,
        ariaLabel:
          'the outcome as a function of the floor value: every floor below the critical 0.4795 fails at the ' +
          'collapsed G = 0.049, and every floor at or above it escapes identically to G = 0.8855 in about 22 time units',
        xMin: 0,
        xMax: 1.2,
        yMin: 0,
        yMax: 1,
        xLabel: 'floor value',
        yLabel: 'final G',
      });
      f.grid({
        xCount: 6,
        yCount: 4,
        xFormat: function (v) {
          return VIZ.fmt(v, 1);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 2);
        },
      });
      f.vline(FLOOR_CRIT, {
        color: VIZ.token('accent'),
        dash: [4, 4],
        label: 'critical 0.4795',
      });
      f.line(
        [
          [0, G_COL],
          [FLOOR_CRIT, G_COL],
          [FLOOR_CRIT, G_HEALTHY],
          [1.2, G_HEALTHY],
        ],
        { color: VIZ.token('accent2'), width: 2.5 },
      );
      f.hline(G_HEALTHY, { color: VIZ.token('dim'), dash: [3, 3], alpha: 0.5, label: 'escape 0.8855' });
      f.hline(G_COL, { color: VIZ.token('dim'), dash: [3, 3], alpha: 0.5, label: 'stuck 0.049' });
      f.textPx('all fail', f.X(0.24), f.Y(0.2), { align: 'center', color: VIZ.token('dim') });
      f.textPx('all escape — identically', f.X(0.85), f.Y(0.72), {
        align: 'center',
        color: VIZ.token('dim'),
      });
      f.dot(floor, end, {
        color: escapes ? VIZ.token('accent2') : VIZ.token('accent'),
        label: escapes ? 'escapes' : 'fails',
        dy: escapes ? -14 : 18,
      });
      f.flushLabels(); // labels last: the step cannot strike through them

      /* --- the escape itself --- */
      var g = VIZ.frame(traceCanvas, {
        height: 200,
        ariaLabel:
          'the escape itself: G rising from the collapsed 0.049 to the healthy 0.8855 in about 22 time units, ' +
          'or staying collapsed at 0.049 when the floor is below the critical value',
        xMin: 0,
        xMax: T_END,
        yMin: 0,
        yMax: 1,
        xLabel: 't — time units',
        yLabel: 'G',
      });
      g.grid({
        xCount: 6,
        yCount: 4,
        xFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 2);
        },
      });
      g.hline(G_COL, { color: VIZ.token('dim'), dash: [3, 3], alpha: 0.5, label: 'collapsed fixed point 0.049' });
      g.hline(G_HEALTHY, { color: VIZ.token('dim'), dash: [3, 3], alpha: 0.5, label: 'healthy 0.8855' });
      g.sample(
        function (t) {
          return escapes ? G_COL + (G_HEALTHY - G_COL) * ramp(t) : G_COL;
        },
        { from: 0, to: T_END, n: 240, color: VIZ.token('accent2'), width: 2 },
      );
      if (escapes) {
        g.vline(ESCAPE, { color: VIZ.token('accent'), dash: [4, 4], label: 'escaped in ~22 t.u.' });
      } else {
        g.textPx('the floor is below what the switch is reading: nothing happens', g.pad.l + 10, g.pad.t + 14, {
          color: VIZ.token('accent'),
        });
      }
      g.flushLabels(); // labels last: the curves cannot strike through them

      /* --- the knowing floor --- */
      var k = VIZ.frame(knowingCanvas, {
        height: 220,
        ariaLabel:
          'the knowing floor: with the floor held at 0.7, re-checking it at c_mon = 0.1, 0.2, 0.3 and 0.5 ' +
          'degrades the final G to 0.53, 0.34, 0.24 and 0.16, with a knowing-floor critical kc of about 0.2',
        xMin: 0,
        xMax: 0.55,
        yMin: 0,
        yMax: 1,
        xLabel: 'c_mon — the cost of re-checking the floor',
        yLabel: 'final G',
      });
      k.grid({
        xCount: 6,
        yCount: 4,
        xFormat: function (v) {
          return VIZ.fmt(v, 2);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 2);
        },
      });
      k.vline(KC, { color: VIZ.token('accent'), dash: [4, 4], label: 'knowing-floor critical kc ≈ 0.2' });
      k.hline(G_HEALTHY, {
        color: VIZ.token('dim'),
        dash: [3, 3],
        alpha: 0.5,
        label: 'never re-checked 0.8855',
      });
      k.line(KNOWING, { color: VIZ.token('accent2'), width: 2 });
      for (var i = 0; i < KNOWING.length; i++) {
        k.dot(KNOWING[i][0], KNOWING[i][1], { label: VIZ.fmt(KNOWING[i][1], 2) });
      }
      k.textPx('floor held at 0.7 throughout', k.pad.l, k.h - k.pad.b - 10, { color: VIZ.token('dim') });
      k.flushLabels(); // labels last: the curves cannot strike through them

      out.set(
        escapes
          ? [
              'floor = ',
              VIZ.bold(VIZ.fmt(floor, 3), true),
              ' → escapes, identically, to ',
              VIZ.bold('0.8855'),
              ' in ~',
              VIZ.bold('22 t.u.'),
              ' — above the step the value makes no difference at all',
            ]
          : [
              'floor = ',
              VIZ.bold(VIZ.fmt(floor, 3)),
              ' → fails: the system stays stuck at ',
              VIZ.bold('0.049'),
              '. The critical value is ',
              VIZ.bold('0.4795', true),
              " — the collapsed state's own error E* = ",
              VIZ.bold('0.4969'),
              ': the floor must sit at or above what the switch is reading',
            ],
      );
    }

    bag.onResize(draw);
    draw();
  }

  function unmount(slot, ctx) {
    ctx.lifecycle.dispose();
  }

  /** Part of the MFE contract; never invoked on a static page. */
  function update(prev, next, ctx) {
    unmount(prev, ctx);
    mount(next, ctx);
  }

  return { mount: mount, unmount: unmount, update: update };
})());
