/**
 * tools/viz/breakthrough.js — C10, "the same procedure, two costumes"
 * (the-breakthrough §2–§6).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. The coercion
 * post's procedure, stage by stage, as the mystical cases ran it and as a
 * secular training ran it: fatigue, the self-attack, the state, the appraisal,
 * the hold. Read down the two columns and the difference is one word — the
 * appraisal — which is the post's finding.
 */
VIZ.registerViz('breakthrough', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  var STAGES = [
    { name: 'the approach', mystical: 'inward attention; a practice', secular: 'fatigue, rules, the clock' },
    { name: 'the self-attack', mystical: 'confession; "self-criticism in small groups"', secular: 'one-on-one confrontation; "sharing" for applause' },
    { name: 'the state', mystical: 'the collapse; the trance; "no-mind"', secular: 'the same collapse \u2014 "getting it," "popping"' },
    { name: 'the appraisal', mystical: 'enlightenment; union; ilumina\u00e7\u00e3o', secular: 'Transformation', differ: true },
    { name: 'the hold', mystical: 'a guru; a lineage', secular: 'a role \u2014 the Forum Leader' },
    { name: 'the cost', mystical: 'a life; a community', secular: '$500, and enrollment' },
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var showDiff = true;

    var toggle = VIZ.button('', function () {
      showDiff = !showDiff;
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(toggle);
    function label() {
      toggle.textContent = showDiff ? 'highlight the one difference \u2713' : 'show the one difference';
    }

    VIZ.share(ctx, {
      get: function () { return { diff: showDiff ? 1 : 0 }; },
      set: function (s) { showDiff = !!Number(s.diff); draw(); },
    });

    function draw() {
      label();
      var f = VIZ.frame(canvas, {
        height: 300,
        ariaLabel:
          'The coercion procedure, stage by stage, as the mystical cases ran it and as a secular training ran it. ' +
          'Six stages: the approach, the self-attack, the state, the appraisal, the hold, the cost. Every stage has an ' +
          'instance in both columns, and the only stage whose instances are different in kind is the appraisal \u2014 ' +
          'enlightenment against Transformation.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var colA = f.pad.l + (f.w - f.pad.l - f.pad.r) * 0.24;
      var colB = f.pad.l + (f.w - f.pad.l - f.pad.r) * 0.60;
      var top = f.pad.t + 4;
      var rowH = 38;

      f.textPx('the stage', left, top, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      f.textPx('mystical', colA, top, { color: VIZ.token('accent2'), font: '600 10px ' + MONO });
      f.textPx('secular', colB, top, { color: VIZ.token('accent'), font: '600 10px ' + MONO });

      ctx2.save();
      ctx2.strokeStyle = VIZ.token('line');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(colA - 12, top + 8);
      ctx2.lineTo(colA - 12, top + 16 + STAGES.length * rowH);
      ctx2.moveTo(colB - 12, top + 8);
      ctx2.lineTo(colB - 12, top + 16 + STAGES.length * rowH);
      ctx2.stroke();
      ctx2.restore();

      for (var i = 0; i < STAGES.length; i++) {
        var S = STAGES[i];
        var y = top + 30 + i * rowH;
        var hot = showDiff && S.differ;

        if (hot) {
          ctx2.save();
          ctx2.fillStyle = VIZ.token('bg2');
          ctx2.fillRect(left - 6, y - 14, f.w - f.pad.l - f.pad.r + 12, rowH - 6);
          ctx2.restore();
        }

        f.textPx(S.name, left, y, { color: VIZ.token('fg'), font: '600 11px ' + MONO });
        f.textPx(S.mystical, colA, y, { color: hot ? VIZ.token('accent') : VIZ.token('accent2') });
        f.textPx(S.secular, colB, y, { color: hot ? VIZ.token('accent') : VIZ.token('accent') });

        if (hot) {
          f.textPx('\u2190 the only difference', colB + 150, y, { color: VIZ.token('accent') });
        }
      }

      out.set(
        showDiff
          ? [
              'the one difference highlighted. ', VIZ.bold('Five of six stages are the same move', true),
              '; only the ', VIZ.bold('appraisal', true), ' differs \u2014 ', VIZ.bold('enlightenment', true),
              ' against ', VIZ.bold('Transformation', true),
              '. The same collapse, named differently \u2014 and the name is the whole product',
            ]
          : [
              'six stages, two costumes: ', VIZ.bold('the approach', true), ', ', VIZ.bold('the self-attack'),
              ', ', VIZ.bold('the state'), ', ', VIZ.bold('the appraisal'), ', ', VIZ.bold('the hold'),
              ', ', VIZ.bold('the cost'),
              '. Read down both columns: the procedure is identical, and only the word for what the state ',
              'means is different',
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
