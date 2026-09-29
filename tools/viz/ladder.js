/**
 * tools/viz/ladder.js — C3, "two ladders" (the-ladder-of-light §3).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. Two hierarchies
 * of the same shape: one built on a skill, which an outsider can check; one built
 * on a private state, which no one can — not the holder, not the student, not the
 * teacher. Set your rung, press "check it", and watch the two ladders disagree
 * about whether the check is even possible.
 */
VIZ.registerViz('ladder', (function () {
  'use strict';

  var RUNGS = 8;
  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var checked = false;

    var level = VIZ.slider({
      label: 'your rung',
      min: 0,
      max: RUNGS,
      step: 1,
      value: 3,
      digits: 0,
      onInput: function () { checked = false; draw(); },
    });
    var checkBtn = VIZ.button('check it', function () { checked = true; draw(); });
    controls.appendChild(level.el);
    controls.appendChild(checkBtn);

    VIZ.share(ctx, {
      get: function () { return { level: level.value(), checked: checked ? 1 : 0 }; },
      set: function (s) {
        if (s.level != null) level.set(s.level);
        checked = !!Number(s.checked);
        draw();
      },
    });

    function draw() {
      var v = level.value();
      var f = VIZ.frame(canvas, {
        height: 260,
        ariaLabel:
          'Two ladders. The left is built on a skill: "check it" audits your rung and confirms it. The right is ' +
          'built on a private state: "check it" cannot measure anything, and the check itself is re-described as ' +
          'the ego. The top of the right ladder is empty.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var lx = f.pad.l + (f.w - f.pad.l - f.pad.r) * 0.24;
      var rx = f.pad.l + (f.w - f.pad.l - f.pad.r) * 0.74;
      var half = (f.w - f.pad.l - f.pad.r) * 0.26;
      var y0 = f.pad.t + 26;
      var y1 = f.h - f.pad.b - 24;
      var step = (y1 - y0) / RUNGS;

      f.textPx('a skill', lx, f.pad.t + 8, { align: 'center', color: VIZ.token('accent2'), font: '600 11px ' + MONO });
      f.textPx('an inner state', rx, f.pad.t + 8, { align: 'center', color: VIZ.token('accent'), font: '600 11px ' + MONO });

      var ctx2 = canvas.getContext('2d');
      ctx2.save();
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      for (var i = 0; i <= RUNGS; i++) {
        var y = y1 - i * step;
        ctx2.beginPath();
        ctx2.moveTo(lx - half, y);
        ctx2.lineTo(lx + half, y);
        ctx2.stroke();
        ctx2.beginPath();
        ctx2.moveTo(rx - half, y);
        ctx2.lineTo(rx + half, y);
        ctx2.stroke();
      }
      // the top of the state ladder: dashed, empty
      ctx2.setLineDash([3, 3]);
      ctx2.beginPath();
      ctx2.moveTo(rx - half, y1 - RUNGS * step);
      ctx2.lineTo(rx + half, y1 - RUNGS * step);
      ctx2.stroke();
      ctx2.setLineDash([]);
      ctx2.restore();

      var yL = y1 - Math.max(0, Math.min(RUNGS, v)) * step;
      f.textPx('● you', lx, yL, { align: 'center', color: VIZ.token('accent2'), baseline: 'middle' });
      f.textPx('● you', rx, yL, { align: 'center', color: VIZ.token('accent'), baseline: 'middle' });

      if (checked) {
        f.textPx('✓ audited — it matches', lx, yL - 11, { align: 'center', color: VIZ.token('accent2') });
        f.textPx('✓ confirmed', lx, y1 + 14, { align: 'center', color: VIZ.token('accent2') });
        f.textPx('? cannot be measured', rx, yL - 11, { align: 'center', color: VIZ.token('accent') });
        f.textPx('checking is the ego', rx, y1 + 14, { align: 'center', color: VIZ.token('accent') });
        f.textPx('(the highest rung is empty)', rx, y1 - RUNGS * step - 12, {
          align: 'center', color: VIZ.token('dim'),
        });
      } else {
        f.textPx('press "check it"', lx, y1 + 14, { align: 'center', color: VIZ.token('dim') });
      }

      out.set(
        checked
          ? [
              'on the left, the check ', VIZ.bold('confirms your rung'),
              ' — a skill can be audited by anyone. On the right, the check ',
              VIZ.bold('cannot measure', true),
              ' and is re-described as ego. A ranking over an unobservable has no result at which it is wrong',
            ]
          : [
              'set your rung and press ', VIZ.bold('check it'),
              '. The left ladder is built on something checkable; the right on something that is not — ',
              'and the difference is the whole of this post',
            ],
      );
    }

    bag.onResize(draw);
    draw();
  }

  function unmount(slot, ctx) {
    ctx.lifecycle.dispose();
  }

  function update(prev, next, ctx) {
    unmount(prev, ctx);
    mount(next, ctx);
  }

  return { mount: mount, unmount: unmount, update: update };
})());
