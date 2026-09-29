/**
 * tools/viz/clinic.js — C12, "what the clinic can measure" (the-differential §3–§5).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. Four things a
 * clinician might measure, and what each actually tells you about a state that
 * cannot report itself. The instrument that asks the person is the one that
 * fails; what survives are the measures taken from outside.
 */
VIZ.registerViz('clinic', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  var ROWS = [
    { name: 'the symptom (self-report)', tells: 'nothing reliable \u2014 false-positives at 54%', ok: false },
    { name: 'the valence (how it feels)', tells: 'the appraisal, not the state', ok: false },
    { name: 'impact on functioning', tells: 'whether a life is impaired', ok: true },
    { name: 'duration', tells: 'whether it is passing or lasting', ok: true },
    { name: 'autonomic signs (from outside)', tells: 'arousal and dissociation, measured', ok: true },
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var showOk = true;

    var toggle = VIZ.button('', function () {
      showOk = !showOk;
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(toggle);
    function label() {
      toggle.textContent = showOk ? 'highlight what survives \u2713' : 'highlight what survives';
    }

    VIZ.share(ctx, {
      get: function () { return { ok: showOk ? 1 : 0 }; },
      set: function (s) { showOk = !!Number(s.ok); draw(); },
    });

    function draw() {
      label();
      var f = VIZ.frame(canvas, {
        height: 260,
        ariaLabel:
          'Five things a clinician might measure, against a state that cannot report itself. The symptom, asked of ' +
          'the person, tells nothing reliable; the valence is the appraisal rather than the state. What survives ' +
          'are impact on functioning, duration, and autonomic signs taken from outside.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var w = f.w - f.pad.l - f.pad.r;
      var top = f.pad.t + 4;
      var nameW = Math.max(210, w * 0.40);
      var rowH = 36;

      f.textPx('what you measure', left, top, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      f.textPx('what it actually tells you', left + nameW, top, { color: VIZ.token('dim'), font: '600 10px ' + MONO });

      for (var i = 0; i < ROWS.length; i++) {
        var r = ROWS[i];
        var y = top + 26 + i * rowH;
        var hot = showOk && r.ok;
        if (hot) {
          ctx2.save();
          ctx2.fillStyle = VIZ.token('bg2');
          ctx2.fillRect(left - 6, y - 13, w + 12, rowH - 8);
          ctx2.restore();
        }
        ctx2.save();
        ctx2.fillStyle = r.ok ? VIZ.token('accent2') : VIZ.token('dim');
        ctx2.fillRect(left, y - 3, 7, 7);
        ctx2.restore();
        f.textPx(r.name, left + 15, y, { color: hot ? VIZ.token('fg') : VIZ.token('dim') });
        f.textPx(r.tells, left + nameW, y, { color: r.ok ? VIZ.token('accent2') : VIZ.token('dim') });
        ctx2.save();
        ctx2.strokeStyle = VIZ.token('line');
        ctx2.globalAlpha = 0.6;
        ctx2.beginPath(); ctx2.moveTo(left, y + 15); ctx2.lineTo(f.w - f.pad.r, y + 15); ctx2.stroke();
        ctx2.restore();
      }

      out.set(
        showOk
          ? [
              'three of five survive: ', VIZ.bold('functioning, duration, autonomic signs', true),
              '. Every one is taken from outside the person \u2014 which is what ',
              VIZ.bold('relocated measurement', true),
              ' means, arrived at by clinicians who needed it to work',
            ]
          : [
              'five candidate measures. The two that ask the person \u2014 the symptom and how it feels \u2014 ',
              'are the two that fail, because the state distorts exactly the faculty that would answer. ',
              'What is left is what can be seen ', VIZ.bold('from outside', true),
            ]);
    }

    bag.onResize(draw);
    paint();
    draw();
    function paint() {} // the toggle carries its own label
  }

  function unmount(slot, ctx) { ctx.lifecycle.dispose(); }
  function update(prev, next, ctx) { unmount(prev, ctx); mount(next, ctx); }
  return { mount: mount, unmount: unmount, update: update };
})());
