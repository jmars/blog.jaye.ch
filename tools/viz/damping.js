/**
 * tools/viz/damping.js — W3, the damping dial (anxiety-damping §2–§3).
 *
 * The post defines damping behaviourally: "It is the return." A perturbed state
 * comes back to baseline fast (high damping) or swings large and comes back
 * slowly or not at all (low damping). This widget is a schematic second-order
 * return — the reader drives the dial and watches the return change.
 *
 * ILLUSTRATIVE BY CONSTRUCTION: the post maps HSP, emotional inertia and the
 * DPDR autonomic signature onto low damping *qualitatively* and publishes no
 * damping curve, so there is no measured trace to reproduce here. The caption
 * says so. Nothing in this widget is a model parameter or a model result.
 */
VIZ.registerViz('damping', (function () {
  'use strict';

  var OMEGA = 0.8; // schematic natural rate, time-units⁻¹
  var T_END = 60;
  var SPEED = 30;
  var ZETA_CANON = 0.15;
  var SETTLED = 0.1; // "back at baseline": within a tenth of the excursion

  /** A schematic perturbation at t = 0: the state swings about the baseline
   * and damps back to it, the faster the higher the damping. */
  function response(t, z) {
    var wd = OMEGA * Math.sqrt(Math.max(0, 1 - z * z));
    if (wd <= 0.001) return OMEGA * t * Math.exp(-OMEGA * t); // critically damped
    return Math.exp(-z * OMEGA * t) * Math.sin(wd * t);
  }

  /** The largest excursion and when it happens. */
  function peak(z) {
    var t = 0;
    var v = 0;
    for (var i = 0; i <= T_END; i += 0.05) {
      if (Math.abs(response(i, z)) > Math.abs(v)) {
        v = response(i, z);
        t = i;
      }
    }
    return { t: t, v: v };
  }

  /** When the state finally settles: the first moment after which it stays
   * within a tenth of its own excursion. 0 = still swinging at the window's
   * end (the low-damping case). */
  function returnTime(z) {
    var lim = SETTLED * Math.abs(peak(z).v);
    var last = -1;
    for (var t = 0; t <= T_END; t += 0.25) {
      if (Math.abs(response(t, z)) >= lim) last = t;
    }
    if (last < 0) return 0;
    var back = last + 0.25;
    return back <= T_END ? back : 0;
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var reveal = T_END;

    var zSlider = VIZ.slider({
      label: 'damping',
      min: 0.05,
      max: 0.98,
      step: 0.01,
      value: ZETA_CANON,
      digits: 2,
      onInput: function () {
        reveal = T_END;
        draw();
      },
    });
    controls.appendChild(zSlider.el);

    var play = bag.loop(function (dt) {
      if (reveal >= T_END) {
        play.stop();
        run.textContent = '▶ run the return';
        draw();
        return;
      }
      reveal = Math.min(T_END, reveal + dt * SPEED);
      draw();
    });

    var run = VIZ.button('▶ run the return', function () {
      if (play.isRunning()) {
        play.stop();
        run.textContent = '▶ resume';
      } else {
        if (reveal >= T_END) reveal = 0;
        run.textContent = '❚❚ pause';
        play.start();
      }
    });
    var reset = VIZ.button('reset', function () {
      play.stop();
      run.textContent = '▶ run the return';
      zSlider.set(ZETA_CANON);
      reveal = T_END;
      draw();
    });
    controls.appendChild(run);
    controls.appendChild(reset);

    function draw() {
      var z = zSlider.value();
      var f = VIZ.frame(canvas, {
        height: 260,
        ariaLabel:
          'an illustrative perturbed state returning to baseline: high damping settles quickly, low damping ' +
          'leaves a large excursion that is slow to return or never returns',
        xMin: 0,
        xMax: T_END,
        yMin: -0.4,
        yMax: 1,
        xLabel: 't — time units after the perturbation',
        yLabel: 'deviation from baseline',
      });
      f.grid({
        xCount: 6,
        yCount: 4,
        xFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 1);
        },
      });
      f.hline(0, { color: VIZ.token('dim'), dash: [3, 3], label: 'baseline' });
      f.sample(
        function (t) {
          return response(t, z);
        },
        { from: 0, to: reveal, n: 400, color: VIZ.token('accent2'), width: 2 },
      );
      var p = peak(z);
      f.dot(p.t, p.v, { label: 'peak excursion ' + VIZ.fmt(p.v, 2), dy: p.v > 0 ? -12 : 14 });
      var back = returnTime(z);
      if (back) {
        f.dot(back, response(back, z), {
          label: 'within 0.1 of baseline at ' + VIZ.fmt(back, 1) + ' t.u.',
          dy: -14,
        });
      }
      if (reveal < T_END) f.vline(reveal, { color: VIZ.token('dim'), dash: [2, 2], alpha: 0.6 });

      f.flushLabels(); // labels last: the curves cannot strike through them

      var slow = z < 0.25;
      out.set([
        'damping = ',
        VIZ.bold(VIZ.fmt(z, 2), slow),
        ' → ',
        slow
          ? 'low damping: a large excursion and a slow return — the shape the post reads as HSP, emotional inertia and the DPDR signature'
          : 'high damping: the same perturbation swings less and returns quickly',
        back
          ? ' · back within a tenth of its own excursion after ' +
            VIZ.fmt(back, 1) +
            ' t.u. (schematic, illustrative — not measured)'
          : ' · still swinging at the end of the window — for the lowest damping the return is effectively absent',
      ]);
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
