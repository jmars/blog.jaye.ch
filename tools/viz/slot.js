/**
 * tools/viz/slot.js — C2, "the unfalsifiable slot" (the-witch-and-the-debt §3).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. Present
 * counter-evidence to a claim whose cause is hidden: the evidence against the
 * claim accumulates, and the claim's position does not move, because every
 * disconfirmation is re-coded inside the frame as a deeper layer, a resistance,
 * or an agency working against the healing.
 */
VIZ.registerViz('slot', (function () {
  'use strict';

  var RECODE = [
    'a deeper layer',
    'your own resistance',
    'an entity working against the healing',
    'you were not ready',
    'the doubt is itself the symptom',
    'a test of your faith',
  ];
  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var n = 0;

    var add = VIZ.button('bring counter-evidence', function () {
      n = n + 1;
      draw();
      VIZ.saveState(ctx);
    });
    var reset = VIZ.button('start over', function () {
      n = 0;
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(add);
    controls.appendChild(reset);

    VIZ.share(ctx, {
      get: function () { return { n: n }; },
      set: function (s) { n = Math.max(0, Math.min(24, Number(s.n) | 0)); draw(); },
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 240,
        ariaLabel:
          'Each press adds one piece of counter-evidence against the claim. The evidence bar fills; the claim ' +
          'does not move, because each disconfirmation is re-described inside the frame as a deeper layer, a ' +
          'resistance, or an agency working against the healing.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var rows = Math.min(n, RECODE.length);
      var top = f.pad.t + 6;
      f.textPx('the claim', f.pad.l, top, { color: VIZ.token('fg'), font: '600 11px ' + MONO });
      f.textPx('"the cause is hidden, and only I can read it"', f.pad.l, top + 14, { color: VIZ.token('dim') });

      for (var i = 0; i < rows; i++) {
        var y = top + 40 + i * 16;
        f.textPx('your counter-evidence ' + (i + 1), f.pad.l, y, { color: VIZ.token('accent2') });
        f.textPx('→ re-coded as: ' + RECODE[i % RECODE.length], f.pad.l + 150, y, { color: VIZ.token('dim') });
      }
      if (n > RECODE.length) {
        f.textPx('… and so on, without end', f.pad.l, top + 40 + rows * 16, { color: VIZ.token('dim') });
      }

      /* two bars: the evidence rises, the claim does not move */
      var ctx2 = canvas.getContext('2d');
      var full = f.w - f.pad.l - f.pad.r;
      var bx = f.pad.l;
      var by = f.h - f.pad.b - 6;
      var evidence = Math.min(1, n / 8);

      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(bx, by - 26, full, 22);
      // evidence
      ctx2.fillStyle = VIZ.token('accent2');
      ctx2.fillRect(bx, by - 26, full * evidence, 10);
      // the claim — pinned full, whatever the evidence
      ctx2.fillStyle = VIZ.token('accent');
      ctx2.fillRect(bx, by - 14, full, 10);
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.rect(bx, by - 26, full, 22);
      ctx2.stroke();
      ctx2.restore();

      // on-bar labels drawn directly (the frame's painter would patch over them);
      // the evidence label needs dark ink while its bar is still empty
      ctx2.font = '10px ' + MONO;
      ctx2.shadowColor = 'rgba(0,0,0,0.6)';   // on-bar ink needs the contrast
      ctx2.shadowBlur = 3;
      ctx2.fillStyle = evidence > 0.35 ? '#ffffff' : VIZ.token('dim');
      ctx2.fillText('evidence against', bx + 4, by - 21);
      ctx2.fillStyle = '#ffffff';
      ctx2.fillText('the claim \u2014 unmoved', bx + 4, by - 9);
      ctx2.shadowBlur = 0;
      ctx2.shadowColor = 'transparent';

      out.set([
        VIZ.bold(String(n)), ' counter-example', n === 1 ? '' : 's',
        ' presented. The claim\'s position: ', VIZ.bold('unchanged', true),
        '. A claim whose cause is hidden consumes every disconfirmation as evidence of itself — ',
        'so there is no result, however negative, at which it is wrong',
      ]);
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
