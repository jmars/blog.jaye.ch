/**
 * tools/viz/activation.js — C14, "the condition decides" (the-follower §4–§5).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. A latent
 * predisposition is held constant; a condition (perceived threat to a way of
 * life) is varied. Only the expression moves. That is Stenner's finding, and the
 * post's answer to what a follower is: not a type, a position the condition
 * activates.
 */
VIZ.registerViz('activation', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var DISPOSITION = 0.62; // held constant — the latent predisposition

    var threat = VIZ.slider({
      label: 'the condition — perceived threat to a way of life',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.75,
      digits: 2,
      onInput: draw,
    });
    controls.appendChild(threat.el);

    VIZ.share(ctx, {
      get: function () { return { threat: threat.value() }; },
      set: function (s) { if (s.threat != null) threat.set(s.threat); draw(); },
    });

    function draw() {
      var t = threat.value();
      // expression is a function of the CONDITION interacting with the
      // disposition: low threat, no expression; the disposition is not enough
      var expression = Math.max(0, Math.min(1, (t - 0.35) / 0.55)) * (0.6 + 0.4 * DISPOSITION);

      var f = VIZ.frame(canvas, {
        height: 250,
        ariaLabel:
          'A latent predisposition, held constant, and a condition that varies. Only the expression moves: at low ' +
          'perceived threat the disposition produces almost no authoritarian expression, and it rises steeply as ' +
          'the threat rises. The disposition alone does not predict the behaviour; the condition decides whether ' +
          'it is expressed.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var w = f.w - f.pad.l - f.pad.r;
      var top = f.pad.t + 4;

      /* the three stacked quantities */
      var rows = [
        ['the latent predisposition', DISPOSITION, VIZ.token('dim'), 'held constant — it is not what moves'],
        ['the condition (threat)', t, VIZ.token('accent2'), 'the slider'],
        ['the expression', expression, VIZ.token('accent'), 'what is actually observed'],
      ];
      var rowH = 44;
      for (var i = 0; i < rows.length; i++) {
        var y = top + 18 + i * rowH;
        f.textPx(rows[i][0], left, y - 12, { color: VIZ.token('dim'), font: '10px ' + MONO });
        ctx2.save();
        ctx2.fillStyle = VIZ.token('bg2');
        ctx2.fillRect(left, y, w, 14);
        ctx2.fillStyle = rows[i][2];
        ctx2.fillRect(left, y, w * rows[i][1], 14);
        ctx2.strokeStyle = VIZ.token('dim');
        ctx2.lineWidth = 1;
        ctx2.beginPath(); ctx2.rect(left, y, w, 14); ctx2.stroke();
        ctx2.restore();
        f.textPx(VIZ.fmt(rows[i][1], 2), left + w * rows[i][1] + 8 > f.w - 40 ? left + 6 : left + w * rows[i][1] + 8, y + 7,
          { color: VIZ.token('fg') });
        // right-aligned to the canvas edge: the note then cannot overflow it and
        // cannot collide with a bar that happens to reach that far
        f.textPx(rows[i][3], f.w - f.pad.r, y - 12, { color: VIZ.token('dim'), align: 'right' });
      }

      /* the threshold note */
      var ty = top + 18 + rows.length * rowH + 4;
      f.textPx(expression < 0.08
        ? 'below the threshold the predisposition produces nothing at all'
        : 'the disposition converts into expression only because the condition is present',
        left, ty, { color: VIZ.token('dim') });

      out.set([
        'disposition ', VIZ.bold(VIZ.fmt(DISPOSITION, 2), true), ' (constant) · condition ',
        VIZ.bold(VIZ.fmt(t, 2)), ' → expression ', VIZ.bold(VIZ.fmt(expression, 2), true),
        '. ', expression < 0.08
          ? 'With the condition removed, the same person produces almost nothing'
          : 'The same person, under threat, produces this',
        ' \u2014 which is why the question is not "who are the authoritarians" but "who is producing the threat"',
      ]);
    }

    bag.onResize(draw);
    draw();
  }

  function unmount(slot, ctx) { ctx.lifecycle.dispose(); }
  function update(prev, next, ctx) { unmount(prev, ctx); mount(next, ctx); }
  return { mount: mount, unmount: unmount, update: update };
})());
