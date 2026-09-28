/**
 * tools/viz/runaway.js — W1, the runaway (meditation-harm §3–§4).
 *
 * Hold attention inward and the generator of self-content is consumed: `G`
 * falls. This widget drives that episode from the sliders and shows the two
 * published regimes — a dose under the threshold that dips and returns, and a
 * dose past it that collapses `G` to the collapsed value and *holds* it there.
 *
 * SCHEMATIC. Every landmark is a number the post publishes:
 *   G* = 0.886            the healthy settled level (§3)
 *   collapsed G = 0.049   the level it is held at afterwards (§4)
 *   a_hold = 0.9          the canonical inward drive (§4)
 *   intensity threshold 0.5992, duration threshold 66.3 t.u. (§4)
 *   "~22 t.u."            the published return timescale (what-actually-works §1)
 *   "G below 0.1 at 73 t.u." (recovery-is-not-immunity §2) fixes the descent rate
 * The sub-threshold dip has no published endpoint and is drawn illustratively.
 */
VIZ.registerViz('runaway', (function () {
  'use strict';

  var G_STAR = 0.886;
  var G_COL = 0.049;
  var A_MIN = 0.5992;
  var A_CANON = 0.9;
  var T_CRIT = 66.3;
  var T_RETURN = 22;
  var T_END = 150;
  var SCHEMATIC_DIP = 0.3;
  var SPEED = 55; // time-units per second of playback
  // the descent rate is fixed by a published landmark: the trace must cross
  // G = 0.1 exactly 73 t.u. into the episode, i.e. 6.7 t.u. after the threshold
  var DESC_TAU = (73 - T_CRIT) / Math.log((G_STAR - G_COL) / (0.1 - G_COL));

  /** G at time x, for an inward drive `a` held for `hold` time-units. */
  function G(x, a, hold) {
    if (a < A_MIN) return G_STAR; // below the published intensity threshold
    var drive = (a - A_MIN) / (1 - A_MIN);
    var dose = hold / T_CRIT;
    if (dose >= 1) {
      // past the threshold: the healthy branch runs straight into the
      // manifold with no warning, then G is consumed and held
      if (x <= T_CRIT) return G_STAR;
      return G_COL + (G_STAR - G_COL) * Math.exp(-(x - T_CRIT) / DESC_TAU);
    }
    var target = G_STAR - drive * (G_STAR - G_COL) * SCHEMATIC_DIP * dose;
    if (x <= hold) return G_STAR + (target - G_STAR) * (1 - Math.exp(-x / T_RETURN));
    var atRelease = G_STAR + (target - G_STAR) * (1 - Math.exp(-hold / T_RETURN));
    return atRelease + (G_STAR - atRelease) * (1 - Math.exp(-(x - hold) / T_RETURN));
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var reveal = T_END;

    var aSlider = VIZ.slider({
      label: 'a_hold',
      min: 0.5,
      max: 1.0,
      step: 0.001,
      value: A_CANON,
      digits: 3,
      onInput: function () {
        reveal = T_END;
        draw();
      },
    });
    var holdSlider = VIZ.slider({
      label: 'hold',
      min: 0,
      max: 120,
      step: 0.1,
      value: T_CRIT,
      digits: 1,
      format: function (v) {
        return VIZ.fmt(v, 1) + ' t.u.';
      },
      onInput: function () {
        reveal = T_END;
        draw();
      },
    });
    controls.appendChild(aSlider.el);
    controls.appendChild(holdSlider.el);

    var play = bag.loop(function (dt) {
      if (reveal >= T_END) {
        play.stop();
        run.textContent = '▶ run the episode';
        draw();
        VIZ.saveState(ctx); // an animation saves its own end state: a slider set() dispatches no input
        return;
      }
      reveal = Math.min(T_END, reveal + dt * SPEED);
      draw();
    });

    var run = VIZ.button('▶ run the episode', function () {
      if (play.isRunning()) {
        play.stop();
        run.textContent = '▶ resume';
        VIZ.saveState(ctx);
      } else {
        if (reveal >= T_END) reveal = 0;
        run.textContent = '❚❚ pause';
        play.start();
      }
    });
    var reset = VIZ.button('reset', function () {
      play.stop();
      run.textContent = '▶ run the episode';
      aSlider.set(A_CANON);
      holdSlider.set(T_CRIT);
      reveal = T_END;
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(run);
    controls.appendChild(reset);

    // shareable frame: #viz=runaway&a_hold=0.9&hold=66.3
    VIZ.share(ctx, {
      get: function () {
        return { a_hold: aSlider.value(), hold: holdSlider.value() };
      },
      set: function (s) {
        if (s.a_hold != null) aSlider.set(s.a_hold);
        if (s.hold != null) holdSlider.set(s.hold);
        play.stop();
        run.textContent = '▶ run the episode';
        reveal = T_END;
        draw();
      },
    });

    function draw() {
      var a = aSlider.value();
      var hold = holdSlider.value();
      var collapsed = a >= A_MIN && hold >= T_CRIT;
      var f = VIZ.frame(canvas, {
        height: 260,
        ariaLabel:
          'G = self-content descending from 0.886 over an inward-attention hold: past the measured 66.3 ' +
          'time-unit duration threshold it collapses to 0.049 and stays there; a shorter or weaker hold only dips and returns',
        xMin: 0,
        xMax: T_END,
        yMin: 0,
        yMax: 1,
        xLabel: 't — time units',
        yLabel: 'G — self-content',
      });
      f.grid({
        xCount: 6,
        yCount: 4,
        xFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 2);
        },
      });
      if (hold > 0) {
        f.band(0, Math.min(hold, T_END), { fill: VIZ.token('bg2') });
      }
      f.hline(G_STAR, { color: VIZ.token('dim'), dash: [3, 3], label: 'G* 0.886' });
      f.hline(G_COL, {
        color: VIZ.token('accent'),
        dash: [3, 3],
        alpha: 0.55,
        label: 'collapsed 0.049',
      });
      f.vline(T_CRIT, {
        color: VIZ.token('accent'),
        dash: [4, 4],
        label: 'measured threshold 66.3 t.u.',
      });
      if (hold > T_CRIT) f.vline(hold, { color: VIZ.token('dim'), dash: [2, 3], alpha: 0.7 });
      f.sample(
        function (x) {
          return G(x, a, hold);
        },
        { from: 0, to: reveal, n: 300, color: VIZ.token('accent2'), width: 2 },
      );
      if (collapsed) f.dot(73, 0.1, { label: 'G < 0.1 at 73 t.u.' });
      if (reveal < T_END) {
        f.vline(reveal, { color: VIZ.token('dim'), dash: [2, 2], alpha: 0.6 });
        f.dot(reveal, G(reveal, a, hold), { color: VIZ.token('fg'), r: 2.6 });
      }

      f.flushLabels(); // labels last: the curves cannot strike through them

      var msg;
      if (a < A_MIN) {
        msg = [
          'under the measured intensity threshold ',
          VIZ.bold('0.5992'),
          ' — the generator is never starved: G stays at ',
          VIZ.bold('0.886'),
        ];
      } else if (collapsed) {
        msg = [
          'past the measured duration threshold ',
          VIZ.bold('66.3 t.u.'),
          ' — collapse: G falls to ',
          VIZ.bold('0.049', true),
          ' and is held there',
        ];
      } else {
        msg = [
          'under the measured duration threshold ',
          VIZ.bold('66.3 t.u.'),
          ' — G dips and returns to ',
          VIZ.bold('0.886'),
          ' (the dip depth is illustrative — no sub-threshold endpoint is published)',
        ];
      }
      out.set([
        'a_hold = ',
        VIZ.bold(VIZ.fmt(a, 3)),
        ' · hold = ',
        VIZ.bold(VIZ.fmt(hold, 1) + ' t.u.'),
        ' → ',
      ].concat(msg));
    }

    bag.onResize(draw);
    draw();
  }

  function unmount(slot, ctx) {
    ctx.lifecycle.dispose();
  }

  /** Never called on a static page (nothing re-binds a slot), but part of the
   * MFE contract: a moved slot tears down and re-mounts. */
  function update(prev, next, ctx) {
    unmount(prev, ctx);
    mount(next, ctx);
  }

  return { mount: mount, unmount: unmount, update: update };
})());
