/**
 * tools/viz/setpoint.js — W5, the setpoint (recovery-is-not-immunity §2–§3).
 *
 * Two identical inward episodes with a full rescue in between. The first panel
 * overlays them on one timeline: the second episode collapses on the same
 * schedule as the first, because a full rescue returns `G` to exactly the value
 * the naïve state already had. The second panel shows why — the setpoint `S`
 * drains 0.76 → 0.13 in each episode, and the arming threshold
 * `Θ_eff = Θ·S/S_rest` falls with it.
 *
 * SCHEMATIC. Published landmarks (§2–§4):
 *   duration threshold to collapse 66.3 t.u. (first) vs 66.0 t.u. (second)
 *   G falls below 0.1 at 73 t.u. into the episode — in both
 *   both episodes start from G ≈ 0.885, and the rescue restores the same value
 *   S 0.76 → 0.13, and the raised threshold after recovery is Θ_eff ≈ 0.76
 *   collapsed G = 0.049
 * The episode lengths, the rescue ramp and the drain shape are schematic. Each
 * episode's descent rate is anchored so its own trace crosses G = 0.1 exactly
 * 73 t.u. into that episode — the published onset — so the "G < 0.1" markers
 * sit on the curve in both panels. Θ itself is not published, so the Θ_eff bar
 * is drawn as Θ_eff = Θ·S/S_rest tracking S (it is the same shape, at the
 * published ≈ 0.76 rest height) rather than as a value of its own.
 */
VIZ.registerViz('setpoint', (function () {
  'use strict';

  var G_STAR = 0.885;
  var G_COL = 0.049;
  var S_REST = 0.76;
  var S_DRAINED = 0.13;
  var EPISODE = 80; // schematic episode length
  var T1 = 0; // episode 1 starts
  var RESCUE = T1 + EPISODE; // full rescue begins
  var T2 = RESCUE + 80; // episode 2 starts, after a settled healthy stretch
  var T_END = T2 + EPISODE + 10;
  var T_CROSS = 66.3; // published duration threshold, episode 1
  var T_CROSS2 = 66.0; // published duration threshold, episode 2
  var T_BELOW = 73; // published: G falls below 0.1 73 t.u. into either episode
  var SPEED = 90;

  var DESC_SPAN = Math.log((G_STAR - G_COL) / (0.1 - G_COL));
  // one descent rate per episode: each trace crosses G = 0.1 at exactly T_BELOW
  var T_DESC_TAU = (T_BELOW - T_CROSS) / DESC_SPAN;
  var T_DESC_TAU2 = (T_BELOW - T_CROSS2) / DESC_SPAN;

  /** 0 → 1 over u ∈ [0, 1], completed exactly at u = 1 (exponential shape). */
  function ramp(u) {
    if (u >= 1) return 1;
    if (u <= 0) return 0;
    var tau = 0.9;
    return (1 - Math.exp(-u / tau)) / (1 - Math.exp(-1 / tau));
  }

  /** G at time t across both episodes. */
  function G(t) {
    if (t <= T1 + T_CROSS) return G_STAR;
    if (t < RESCUE) return G_COL + (G_STAR - G_COL) * Math.exp(-(t - T1 - T_CROSS) / T_DESC_TAU);
    var atRescue = G_COL + (G_STAR - G_COL) * Math.exp(-(EPISODE - T_CROSS) / T_DESC_TAU);
    if (t < T2) return G_STAR - (G_STAR - atRescue) * (1 - ramp((t - RESCUE) / (T2 - RESCUE)));
    if (t <= T2 + T_CROSS2) return G_STAR;
    return G_COL + (G_STAR - G_COL) * Math.exp(-(t - T2 - T_CROSS2) / T_DESC_TAU2);
  }

  /** The allostatic setpoint, and with it Θ_eff = Θ·S/S_rest. */
  function S(t) {
    if (t >= RESCUE && t < T2) return S_DRAINED + (S_REST - S_DRAINED) * ramp((t - RESCUE) / (T2 - RESCUE));
    var start = t < RESCUE ? T1 : T2;
    return S_REST - (S_REST - S_DRAINED) * ramp((t - start) / EPISODE);
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var gCanvas = bag.node('canvas', 'viz-canvas');
    var sCanvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var cursor = T_END;

    var timeSlider = VIZ.slider({
      label: 'time cursor',
      min: 0,
      max: T_END,
      step: 1,
      value: T_END,
      digits: 0,
      format: function (v) {
        return VIZ.fmt(v, 0) + ' t.u.';
      },
      onInput: function (v) {
        cursor = v;
        draw();
      },
    });
    controls.appendChild(timeSlider.el);

    var play = bag.loop(function (dt) {
      if (cursor >= T_END) {
        play.stop();
        run.textContent = '▶ play the timeline';
        draw();
        return;
      }
      cursor = Math.min(T_END, cursor + dt * SPEED);
      timeSlider.set(cursor);
      draw();
    });

    var run = VIZ.button('▶ play the timeline', function () {
      if (play.isRunning()) {
        play.stop();
        run.textContent = '▶ resume';
      } else {
        if (cursor >= T_END) cursor = 0;
        run.textContent = '❚❚ pause';
        play.start();
      }
    });
    var reset = VIZ.button('reset', function () {
      play.stop();
      run.textContent = '▶ play the timeline';
      cursor = T_END;
      timeSlider.set(cursor);
      draw();
    });
    controls.appendChild(run);
    controls.appendChild(reset);

    function episodes(f, labelAt) {
      f.band(T1, RESCUE, { fill: VIZ.token('bg2'), label: 'episode 1', labelAt: labelAt });
      f.band(RESCUE, T2, { fill: VIZ.token('bg2'), alpha: 0.5, label: 'full rescue', labelAt: labelAt });
      f.band(T2, T2 + EPISODE, { fill: VIZ.token('bg2'), label: 'episode 2', labelAt: labelAt });
    }

    function draw() {
      /* --- G across both episodes --- */
      var f = VIZ.frame(gCanvas, {
        height: 260,
        ariaLabel:
          'G = self-content across two identical inward episodes separated by a full rescue: both start at ' +
          'G = 0.885, both collapse at the 66.3 and 66.0 time-unit thresholds, and both fall below G = 0.1 ' +
          '73 time units into the episode',
        xMin: 0,
        xMax: T_END,
        yMin: 0,
        yMax: 1,
        xLabel: 't — time units',
        yLabel: 'G — self-content',
      });
      f.grid({
        xCount: 8,
        yCount: 4,
        xFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 2);
        },
      });
      episodes(f, 'bottom');
      f.hline(G_STAR, { color: VIZ.token('dim'), dash: [3, 3], alpha: 0.5, label: 'G 0.885, both times' });
      f.hline(0.1, { color: VIZ.token('accent'), dash: [4, 4], alpha: 0.5, label: 'G 0.1' });
      f.vline(T1 + T_CROSS, { color: VIZ.token('accent'), dash: [4, 4], label: '66.3 t.u.' });
      f.vline(T2 + T_CROSS2, { color: VIZ.token('accent'), dash: [4, 4], label: '66.0 t.u.' });
      f.sample(G, { from: 0, to: T_END, n: 900, color: VIZ.token('accent2'), width: 2 });
      // the published onset, at the point the trace actually crosses G = 0.1
      f.dot(T1 + T_BELOW, G(T1 + T_BELOW), { label: 'G < 0.1', dy: 12, align: 'right', dx: -8 });
      f.dot(T2 + T_BELOW, G(T2 + T_BELOW), { label: 'G < 0.1', dy: 12, align: 'right', dx: -8 });
      f.vline(cursor, { color: VIZ.token('fg'), dash: [2, 3], alpha: 0.7 });
      f.dot(cursor, G(cursor), { color: VIZ.token('fg') });
      f.flushLabels(); // labels last: the rules cannot strike through them

      /* --- S and the Θ_eff bar --- */
      var s = VIZ.frame(sCanvas, {
        height: 220,
        ariaLabel:
          'the allostatic setpoint S draining 0.76 to 0.13 in each episode, and the arming threshold ' +
          'Θ_eff = Θ·S/S_rest falling with it, from its raised 0.76 rest height',
        xMin: 0,
        xMax: T_END,
        yMin: 0,
        yMax: 0.8,
        xLabel: 't — time units',
        yLabel: 'S, and the Θ_eff bar',
      });
      s.grid({
        xCount: 8,
        yCount: 4,
        xFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 1);
        },
      });
      episodes(s, 'top');
      s.hline(S_REST, { color: VIZ.token('dim'), dash: [3, 3], alpha: 0.5, label: 'S 0.76 (rest)' });
      s.hline(S_DRAINED, { color: VIZ.token('accent'), dash: [3, 3], alpha: 0.5, label: 'S 0.13 (drained)' });
      // the falling bar: Θ_eff = Θ·S/S_rest, shaded under the trace
      var pts = [];
      var i;
      for (i = 0; i <= T_END; i += 2) pts.push([i, S(i)]);
      for (i = 0; i < pts.length - 1; i++) {
        s.ctx.save();
        s.ctx.fillStyle = VIZ.token('accent');
        s.ctx.globalAlpha = 0.16;
        s.ctx.beginPath();
        s.ctx.moveTo(s.X(pts[i][0]), s.Y(0));
        s.ctx.lineTo(s.X(pts[i][0]), s.Y(pts[i][1]));
        s.ctx.lineTo(s.X(pts[i + 1][0]), s.Y(pts[i + 1][1]));
        s.ctx.lineTo(s.X(pts[i + 1][0]), s.Y(0));
        s.ctx.closePath();
        s.ctx.fill();
        s.ctx.restore();
      }
      s.line(pts, { color: VIZ.token('accent'), width: 2 });
      s.vline(cursor, { color: VIZ.token('fg'), dash: [2, 3], alpha: 0.7 });
      s.dot(cursor, S(cursor), { color: VIZ.token('fg') });
      s.flushLabels(); // labels last: the rules cannot strike through them

      out.set([
        't = ',
        VIZ.bold(VIZ.fmt(cursor, 0) + ' t.u.'),
        ' · G = ',
        VIZ.bold(VIZ.fmt(G(cursor), 3)),
        ' · S = ',
        VIZ.bold(VIZ.fmt(S(cursor), 3)),
        ' · Θ_eff = Θ·S/S_rest moves with S (≈ 0.76 while S rests, the raised threshold; Θ itself is not published) — collapse thresholds ',
        VIZ.bold('66.3 vs 66.0 t.u.', true),
        ' (the same within a grid step), G below 0.1 at ',
        VIZ.bold('73 t.u. in both'),
        ': the rescue bought the recovered state nothing',
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
