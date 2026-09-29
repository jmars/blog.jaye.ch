/**
 * tools/viz/exit.js — C13, "after the room" (after-the-room §4).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. Three states
 * of a frame: the one that held you, the gap after leaving, and the one that has
 * not arrived. Step through them — the model says the middle one cannot be
 * resolved from inside, which is what the exit studies describe.
 */
VIZ.registerViz('exit', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  var PHASES = [
    { key: 'inside', frame: 'a frame, held by the group', self: 0.72, note: 'the worldview you were given; it explains everything, including why leaving is danger' },
    { key: 'leaving', frame: 'a frame, and no exit of your own', self: 0.9, note: 'the state cannot initiate its own exit — it needs someone outside the loop' },
    { key: 'in-between', frame: 'none yet', self: 0.4, note: 'a lost worldview with nothing in its place: the "in-between time"' },
    { key: 'after', frame: 'a frame you chose, and can check', self: 0.8, note: 'the only version that holds: a relationship, not a verdict' },
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var at = 2; // the in-between is the point

    var btns = PHASES.map(function (p, i) {
      var b = VIZ.button(p.key, function () {
        at = i;
        paint();
        draw();
        VIZ.saveState(ctx);
      });
      controls.appendChild(b);
      return b;
    });

    function paint() {
      btns.forEach(function (b, i) {
        b.style.borderColor = i === at ? VIZ.token('accent') : '';
        b.style.color = i === at ? VIZ.token('accent') : '';
      });
    }

    VIZ.share(ctx, {
      get: function () { return { phase: at }; },
      set: function (s) { if (s.phase != null) at = Math.max(0, Math.min(PHASES.length - 1, Number(s.phase) | 0)); paint(); draw(); },
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 250,
        ariaLabel:
          'Four phases: inside the group, the moment of leaving, the in-between time with no frame, and after — ' +
          'a frame you chose and can check. The bar is how much the person can see their own state, and it is ' +
          'lowest in the in-between, which is why the middle cannot be resolved from inside.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var w = f.w - f.pad.l - f.pad.r;
      var top = f.pad.t + 6;

      /* the four phases as a timeline */
      var gap = 6;
      var bw = (w - gap * (PHASES.length - 1)) / PHASES.length;
      for (var k = 0; k < PHASES.length; k++) {
        var x = left + k * (bw + gap);
        var on = k === at;
        ctx2.save();
        ctx2.fillStyle = on ? VIZ.token('accent') : VIZ.token('bg2');
        ctx2.fillRect(x, top, bw, 26);
        ctx2.strokeStyle = on ? VIZ.token('accent') : VIZ.token('dim');
        ctx2.lineWidth = 1;
        ctx2.beginPath(); ctx2.rect(x, top, bw, 26); ctx2.stroke();
        ctx2.restore();
        f.textPx(PHASES[k].key, x + 6, top + 14, {
          color: on ? '#ffffff' : VIZ.token('dim'), font: '600 10px ' + MONO,
        });
      }

      var p = PHASES[at];
      f.textPx('the frame', left, top + 50, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      f.textPx(p.frame, left, top + 66, { color: VIZ.token('accent'), font: '600 12px ' + MONO });
      f.textPx(p.note, left, top + 84, { color: VIZ.token('dim') });

      /* how much of the state the person can see — lowest in the in-between */
      var by = top + 116;
      f.textPx('what the person can see of their own state', left, by - 8, {
        color: VIZ.token('dim'), font: '10px ' + MONO,
      });
      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(left, by, w, 16);
      ctx2.fillStyle = p.self < 0.5 ? VIZ.token('accent') : VIZ.token('accent2');
      ctx2.fillRect(left, by, w * p.self, 16);
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath(); ctx2.rect(left, by, w, 16); ctx2.stroke();
      ctx2.restore();
      f.textPx(VIZ.fmt(p.self, 2), left + w * p.self + 8 > f.w - 40 ? left + 6 : left + w * p.self + 8, by + 8,
        { color: VIZ.token('fg') });

      out.set(
        at === 2
          ? [
              'the ', VIZ.bold('in-between', true),
              ': the frame is gone and nothing has replaced it. This is the phase the exit studies describe \u2014 ',
              'and the one the model says ', VIZ.bold('cannot be resolved from inside', true),
              ', because the state cannot initiate its own exit',
            ]
          : [
              p.key + ': ' + p.frame + '. ',
              at === 3
                ? 'The only version that holds \u2014 ' + VIZ.bold('a relationship, not a verdict', true)
                : 'Step through to the in-between, where the model\u2019s prediction lives',
            ]);
    }

    bag.onResize(draw);
    paint();
    draw();
  }

  function unmount(slot, ctx) { ctx.lifecycle.dispose(); }
  function update(prev, next, ctx) { unmount(prev, ctx); mount(next, ctx); }
  return { mount: mount, unmount: unmount, update: update };
})());
