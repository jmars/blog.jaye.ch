/**
 * tools/viz/policy.js — the harness §4 (the codec selection policy).
 *
 * THE SELECTION RULES S1–S5 AS A DECISION THE READER CAN DRIVE. The policy
 * is RULES WITH STATED RATIONALES, NO WEIGHTS, NO SUMS (the GatePolicy
 * precedent): pick an entry's attributes — tier, whether its content is
 * fully structured, bulk-duplicate, hot or cold, its size — and see which
 * codec the policy returns and WHY, in the policy's own words.
 *
 * The live evaluation order is the BUILT policy's (S4 first among
 * re-encodes, because it binds S1 too), the spec's precedence stated
 * beside it. Two cases the reader must be able to reach: the one that
 * returns IDENTITY because no rule claims the entry (S5 — identity is the
 * honest codec until a schedule runs), and the LOW-TIER entry that never
 * reaches the policy at all (the gate already decided; its codec stays
 * identity forever). S3's outcome is IDENTITY with the gap STATED
 * (latent_required) — never a pretend-latent.
 *
 * Every rule's head and text is CURATED FROM THE DESIGN, read from the
 * page's data block; the figure's own live path is the implementation's
 * order, marked as such in the readout.
 */
VIZ.registerViz('policy', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  /** The page's own data block (the generator's curated codec rules). */
  function data() {
    var el = document.getElementById('viz-data-harness');
    if (!el) return null;
    try {
      var d = JSON.parse(el.textContent);
      return d && d.codecs && d.codecs.rules && d.codecs.rules.length === 5 ? d.codecs : null;
    } catch (e) {
      return null;
    }
  }

  /** The BUILT policy's evaluation order (the spec's S1–S5 precedence, with
   * S4 hoisted to the front among re-encodes because it also binds S1 —
   * a hot entry is never re-encoded, even to schema). Each predicate fires
   * or falls through; the first that fires decides. The decision returned
   * here is the figure's own live replay of the built rule order; the rule
   * TEXT is the design's, from the data block. */
  function decide(st) {
    // st: { tier ('self_content'|'self_content_low'), structured, bulk, hot, size }
    if (st.tier === 'self_content_low') {
      // the low tier never reaches the policy at all — the gate already
      // decided; there is no consolidation-time codec decision for it
      return { rule: null, codec: 'identity', low: true, why: null };
    }
    if (st.hot) {
      return { rule: 'S4', codec: st.existing || 'identity', low: false, why: 'an access in the current window keeps the existing codec until the entry goes cold — S4 binds S1 too: switching under load couples the injected self\u2019s representation to its use' };
    }
    if (st.structured) {
      return { rule: 'S1', codec: 'schema', low: false, why: 'zero drift at the cheapest cost; refusing free fidelity would be trading it for nothing' };
    }
    if (st.bulk) {
      return { rule: 'S3', codec: 'identity', latent: true, low: false, why: 'bulk duplicate content → LATENT required, but LATENT is NOT BUILT: its objective is the task Y and without Y it degrades to an autoencoder — IDENTITY kept with the gap stated, never a pretend-latent' };
    }
    if (st.size >= 200) {
      return { rule: 'S2', codec: 'gist', low: false, why: 'narrative content, cold, size at or over the floor (gist_min_chars = 200, a named DESIGNER CHOICE, placeholder until a real store exists at horizon size) — one gist call at the consolidation boundary' };
    }
    return { rule: 'S5', codec: 'identity', low: false, why: 'no rule claims this entry: identity kept, the honest codec until the schedule runs the policy on the run path' };
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var d = data();
    if (!d) {
      out.set(['the figure is missing its own data — every rule on it is curated from the design, and there is none to draw.']);
      return;
    }

    // the entry's attributes — the §4.1 inputs, all of them already computed
    // elsewhere (the policy reads, it never measures). The plant's own state
    // (E, c, G) is deliberately NOT an input, and the figure never offers it.
    var tier = 'self_content'; // 'self_content' | 'self_content_low'
    var structured = false;
    var bulk = false;
    var hot = false;
    var size = 340; // chars
    var GIST_MIN = 200; // the policy's own frozen floor's placeholder default

    var tierBtn = VIZ.button('tier: consolidating', function () {
      tier = tier === 'self_content' ? 'self_content_low' : 'self_content';
      tierBtn.textContent = tier === 'self_content' ? 'tier: consolidating' : 'tier: LOW (never reaches the policy)';
      paint();
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(tierBtn);

    var structBtn = VIZ.button('content: narrative', function () {
      structured = !structured;
      if (structured) bulk = false;
      structBtn.textContent = structured ? 'content: fully structured' : 'content: narrative';
      if (structured) bulkBtn.textContent = 'bulk duplicate: no';
      paint();
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(structBtn);

    var bulkBtn = VIZ.button('bulk duplicate: no', function () {
      bulk = !bulk;
      if (bulk) structured = false;
      bulkBtn.textContent = bulk ? 'bulk duplicate: yes' : 'bulk duplicate: no';
      if (bulk) structBtn.textContent = 'content: narrative';
      paint();
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(bulkBtn);

    var hotBtn = VIZ.button('access: cold', function () {
      hot = !hot;
      hotBtn.textContent = hot ? 'access: HOT this window' : 'access: cold';
      paint();
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(hotBtn);

    var sizeSlider = VIZ.slider({
      label: 'size (chars)',
      min: 20,
      max: 900,
      step: 20,
      value: size,
      digits: 0,
      onInput: function (v) {
        size = v;
        draw();
      },
    });
    controls.appendChild(sizeSlider.el);

    function paint() {
      var on = VIZ.token('accent');
      tierBtn.style.color = tier === 'self_content_low' ? on : '';
      structBtn.style.color = structured ? on : '';
      bulkBtn.style.color = bulk ? on : '';
      hotBtn.style.color = hot ? on : '';
    }

    VIZ.share(ctx, {
      get: function () {
        return {
          t: tier === 'self_content_low' ? 1 : 0,
          c: structured ? 1 : 0,
          b: bulk ? 1 : 0,
          h: hot ? 1 : 0,
          s: size,
        };
      },
      set: function (st) {
        if (st.t != null) tier = st.t === 1 ? 'self_content_low' : 'self_content';
        if (st.c != null) structured = st.c === 1;
        if (st.b != null) bulk = st.b === 1;
        if (st.h != null) hot = st.h === 1;
        if (st.s != null) {
          size = Math.max(20, Math.min(900, Number(st.s)));
          sizeSlider.set(size);
        }
        if (structured && bulk) bulk = false;
        tierBtn.textContent = tier === 'self_content' ? 'tier: consolidating' : 'tier: LOW (never reaches the policy)';
        structBtn.textContent = structured ? 'content: fully structured' : 'content: narrative';
        bulkBtn.textContent = bulk ? 'bulk duplicate: yes' : 'bulk duplicate: no';
        hotBtn.textContent = hot ? 'access: HOT this window' : 'access: cold';
        paint();
        draw();
      },
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 300,
        ariaLabel:
          'the codec selection policy: pick an entry\u2019s attributes — tier, whether its content is fully ' +
          'structured, bulk-duplicate, hot or cold, its size — and see which codec the rules S1 to S5 ' +
          'return and why. The rules have stated rationales and no weights; the low tier never reaches ' +
          'the policy at all; a bulk entry returns identity with the latent gap stated; and an entry no ' +
          'rule claims keeps identity, the honest codec until a schedule exists.',
        xMin: 0,
        xMax: 10,
        yMin: 0,
        yMax: 6,
        pad: { l: 20, r: 20, t: 30, b: 14 },
      });

      var dec = decide({ tier: tier, structured: structured, bulk: bulk, hot: hot, size: size });

      // the five rules as a ladder the reader's entry walks down: each rule
      // drawn with its id and head, the one that FIRES drawn bold and its
      // id in the accent; the rules it fell past drawn dim. The LOW-tier
      // case draws the whole ladder dimmed with its own note — the entry
      // never reaches the policy at all.
      var y = 44;
      var rowH = 34;
      for (var i = 0; i < d.rules.length; i++) {
        var r = d.rules[i];
        var fires = dec.rule === r.id;
        var dimmed = dec.low || !fires;
        // the head is drawn WHOLE. It used to be cut at 44 characters, which
        // silently dropped a rule's operative clause (S2's "COLD-ONLY"); the
        // heads are bounded and short, and the smoke asserts every label lands
        // inside the canvas — so a head that ever grew too long would fail the
        // gate rather than quietly lose its meaning here.
        var head = r.head;
        f.textPx(r.id, f.pad.l + 4, y + 10, {
          font: '600 11px ' + MONO,
          color: fires ? VIZ.token('accent') : VIZ.token('dim'),
        });
        f.textPx(head, f.pad.l + 38, y + 10, {
          font: (fires ? '600 ' : '') + '10px ' + MONO,
          color: fires ? VIZ.token('fg') : VIZ.token('dim'),
        });
        if (fires) {
          f.textPx('→ ' + dec.codec.toUpperCase() + (dec.latent ? ' (latent_required: the gap stated)' : ''), f.w - f.pad.r - 4, y + 10, {
            align: 'right',
            font: '600 10px ' + MONO,
            color: VIZ.token('accent'),
          });
        }
        y += rowH;
      }

      // the ownership ladder, always drawn: the codec policy is the THIRD
      // externally-owned selector — a mechanism choosing its own codec would
      // choose the one that makes its own content easiest to predict and
      // smallest (a self-serving compression, the project's subject one layer
      // down), so the policy is a frozen dataclass the designer injects
      f.textPx('the externally-owned selectors:', f.pad.l, y + 18, { font: '600 9.5px ' + MONO, color: VIZ.token('dim') });
      var lx = f.pad.l + 200;
      for (var j = 0; j < d.ownership.ladder.length; j++) {
        var l = d.ownership.ladder[j];
        var isThis = j === d.ownership.ladder.length - 1;
        f.textPx((j + 1) + '. ' + l.n, lx, y + 18 + j * 13, {
          font: (isThis ? '600 ' : '') + '9px ' + MONO,
          color: isThis ? VIZ.token('fg') : VIZ.token('dim'),
        });
      }
      f.flushLabels();

      // the readout: the decision, in the policy's own words
      var parts = [];
      if (dec.low) {
        parts.push(VIZ.bold('LOW TIER — never reaches the policy at all', true));
        parts.push(': ' + d.lowTier);
        parts.push('  ‖  the codec stays ');
        parts.push(VIZ.bold('IDENTITY', true));
        parts.push(', stated.');
      } else if (dec.rule) {
        var ruleRow = null;
        for (var q = 0; q < d.rules.length; q++) if (d.rules[q].id === dec.rule) ruleRow = d.rules[q];
        parts.push(VIZ.bold(dec.rule + ' fires', true));
        parts.push(' — ' + ruleRow.head + ' → ');
        parts.push(VIZ.bold(dec.codec.toUpperCase(), true));
        if (dec.latent) parts.push(' with latent_required (LATENT is not buildable: the gap stated, never a pretend-latent)');
        parts.push('. Why: ' + dec.why + '.');
      } else {
        parts.push(VIZ.bold('no rule fires', true));
        parts.push(' → ');
        parts.push(VIZ.bold('IDENTITY', true));
        parts.push(' — ' + dec.why + '.');
      }
      parts.push('  ‖  no weights, no sums — the first rule that fires decides (the GatePolicy precedent); the policy is a frozen dataclass injected with the consolidation seat.');
      out.set(parts);
    }

    bag.onResize(draw);
    paint();
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
