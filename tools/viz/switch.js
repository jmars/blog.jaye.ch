/**
 * tools/viz/switch.js — W2, the cannibalization switch (meditation-harm §4, §8).
 *
 * One timeline, three published quantities: the error `E = D − G` rising out of
 * the healthy equilibrium, the arming threshold `Θ_eff = Θ·S/S_rest` falling as
 * the setpoint drains, and the switch `c = σ·max(0, tanh((E − Θ_eff)/w))`.
 *
 * SCHEMATIC. Published landmarks, from the post that hosts this figure
 * (meditation-harm — it prints its own threshold pair, §8):
 *   E healthy −0.340 → after the transition +0.525 (§4)
 *   c 0.000 → 1.000, "exactly zero" cost below threshold (§4)
 *   S 0.865 → 0.167, so the arming threshold Θ_eff falls 79%, 0.64 → 0.134 (§8)
 *   66.3 t.u. — the duration threshold, i.e. the moment E meets Θ_eff (§4)
 *   the healthy regime's cost is exactly zero: max|ΔG| = 0.00e+00 (§4)
 * E is one exponential shape, pinned so the trace starts on the published
 * −0.340, lands on the published +0.525 at the end of the episode, and meets
 * the falling Θ_eff exactly at the published 66.3 t.u. — so the ignition point
 * is a crossing the reader can see, drawn only from published values. Θ_eff is
 * the falling dashed line from its rest 0.64 to its drained 0.134. c is drawn
 * as the measured step (0.000 → 1.000); the tanh width `w` is not published.
 */
VIZ.registerViz('switch', (function () {
  'use strict';

  var E_HEALTHY = -0.34;
  var E_COLLAPSED = 0.525;
  var TH_REST = 0.64;
  var TH_DRAINED = 0.134;
  var A_MIN = 0.5992;
  var A_CANON = 0.9;
  var T_CROSS = 66.3;
  var T_END = 150;
  var SPEED = 55;

  /** The arming threshold across the episode: rest 0.64 → drained 0.134. */
  function thAt(x) {
    return TH_REST + (TH_DRAINED - TH_REST) * (x / T_END);
  }

  /** E's shape over [0, T_END]: 0 → 1, exponential, completed at T_END. */
  function ease(x, tau) {
    return (1 - Math.exp(-x / tau)) / (1 - Math.exp(-T_END / tau));
  }

  // The one shape rate that makes E meet Θ_eff at the published 66.3 t.u. while
  // still landing exactly on +0.525 at T_END: solve ease(T_CROSS, τ) = the
  // share of the −0.340 → +0.525 span that Θ_eff(66.3) sits at. ease falls
  // monotonically in τ, so a bisection is exact to double precision.
  var MEET = (thAt(T_CROSS) - E_HEALTHY) / (E_COLLAPSED - E_HEALTHY);
  var E_TAU = (function () {
    var lo = 1e-3;
    var hi = 1e6;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (ease(T_CROSS, mid) > MEET) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  })();

  function eAt(x) {
    return E_HEALTHY + (E_COLLAPSED - E_HEALTHY) * ease(x, E_TAU);
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var reveal = T_END;

    var aSlider = VIZ.slider({
      label: 'inward drive',
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
    controls.appendChild(aSlider.el);

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
      reveal = T_END;
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(run);
    controls.appendChild(reset);

    // shareable frame: #viz=switch&a=0.72 restores this slider
    VIZ.share(ctx, {
      get: function () {
        return { a: aSlider.value() };
      },
      set: function (s) {
        if (s.a != null) aSlider.set(s.a);
        play.stop();
        run.textContent = '▶ run the episode';
        reveal = T_END;
        draw();
      },
    });

    function draw() {
      var a = aSlider.value();
      var armed = a >= A_MIN;
      var f = VIZ.frame(canvas, {
        height: 280,
        ariaLabel:
          'the error E = D − G rising from −0.340 to +0.525 and meeting the arming threshold Θ_eff, ' +
          'which falls from 0.64 to 0.134, at the measured 66.3 time units; the switch c ignites from 0.000 to 1.000 there',
        xMin: 0,
        xMax: T_END,
        yMin: -0.6,
        yMax: 1.15,
        xLabel: 't — time units',
        yLabel: 'E, Θ_eff, c',
      });
      f.grid({
        xCount: 6,
        yCount: 5,
        xFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 1);
        },
      });

      var e = function (x) {
        return armed ? eAt(x) : E_HEALTHY;
      };
      var th = function (x) {
        return armed ? thAt(x) : TH_REST;
      };

      // published endpoints as reference lines
      f.hline(E_HEALTHY, { color: VIZ.token('dim'), dash: [3, 3], label: 'E −0.340 (healthy)' });
      f.hline(1, { color: VIZ.token('fg'), dash: [2, 4], alpha: 0.45, label: 'c 1.000' });
      f.hline(0, { color: VIZ.token('fg'), dash: [2, 4], alpha: 0.45, label: 'c 0.000' });

      // the switch: a step at the border collision
      if (armed && reveal > T_CROSS) {
        f.line(
          [
            [T_CROSS, 0],
            [T_CROSS, 1],
          ],
          { color: VIZ.token('fg'), width: 2 },
        );
        f.sample(
          function () {
            return 1;
          },
          { from: T_CROSS, to: reveal, color: VIZ.token('fg'), width: 2 },
        );
        f.sample(
          function () {
            return 0;
          },
          { from: 0, to: T_CROSS, color: VIZ.token('fg'), width: 2 },
        );
      } else {
        f.sample(
          function () {
            return 0;
          },
          { from: 0, to: reveal, color: VIZ.token('fg'), width: 2 },
        );
      }

      // the falling threshold, and the error rising to meet it
      f.sample(th, { from: 0, to: reveal, n: 300, color: VIZ.token('accent'), width: 2, dash: [5, 3] });
      f.sample(e, { from: 0, to: reveal, n: 300, color: VIZ.token('accent2'), width: 2 });
      f.dot(0, th(0), { color: VIZ.token('accent'), dx: 7, label: 'Θ_eff 0.64 (rest)' });
      if (armed && reveal > T_CROSS) {
        f.dot(T_CROSS, th(T_CROSS), { label: 'border collision: E meets Θ_eff', dy: 18 });
      }
      if (armed && reveal >= T_END) {
        f.dot(T_END, th(T_END), {
          color: VIZ.token('accent'),
          align: 'right',
          dx: -7,
          dy: -12,
          label: 'Θ_eff 0.134 (drained)',
        });
        f.dot(T_END, eAt(T_END), {
          color: VIZ.token('accent2'),
          align: 'right',
          dx: -7,
          dy: -12,
          label: 'E +0.525',
        });
      }
      if (reveal < T_END) f.vline(reveal, { color: VIZ.token('dim'), dash: [2, 2], alpha: 0.6 });

      f.flushLabels(); // labels last: the curves cannot strike through them

      var msg;
      if (!armed) {
        msg = [
          'under the measured intensity threshold ',
          VIZ.bold('0.5992'),
          ' — the switch never arms: c = ',
          VIZ.bold('0.000'),
          ' throughout, E stays at −0.340 and Θ_eff at its 0.64 rest level, and the healthy regime costs ',
          VIZ.bold('exactly zero'),
          ' (max|ΔG| = 0.00e+00)',
        ];
      } else {
        msg = [
          'E crosses Θ_eff at the measured ',
          VIZ.bold('66.3 t.u.', true),
          ' and c ignites ',
          VIZ.bold('0.000 → 1.000'),
          '; attention is captured, a → ',
          VIZ.bold('0.882'),
          ', inward, held — the setpoint drains S 0.865 → 0.167, so Θ_eff falls ',
          VIZ.bold('79% (0.64 → 0.134)'),
        ];
      }
      out.set(
        [
          'inward drive = ',
          VIZ.bold(VIZ.fmt(a, 3)),
          ' · c = σ·max(0, tanh((E − Θ_eff)/w)), Θ_eff = Θ·S/S_rest → ',
        ].concat(msg),
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
