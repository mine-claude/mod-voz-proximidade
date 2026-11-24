// @ts-check
// The `/voz` screen, drawn on the game's GUI layer with the widget KIT (`f.ui`): no HTML, no outside
// image, and the same look as the rest of the game because the components are the ones registered in the theme.
//
// What it solves, and why each control exists:
//   - TURNING the microphone on is an explicit switch. Until it is on, the speak key opens nothing.
//   - the mode (push-to-talk / open voice) is in a dropdown, with push-to-talk as the default.
//   - OVERALL VOLUME of all voices, and "hear nobody" in a switch (deafen).
//   - the LIST of who is nearby, with a button per person to mute just them, here, without asking anyone anything.
//   - the state: whether this browser can speak, whether it can hear, and why not, with the buffer delay of whoever speaks.
//
// LAYOUT: the `ui.column` is a cursor, and each component has to ask for the HEIGHT IT DRAWS — not that of its click
// rectangle. The kit's slider and progress bar draw the label ABOVE the y they receive (`y - LINE`), so
// whoever reserves only one line for them writes the label over the previous component. That is exactly what this
// screen did: in the browser, "Volume" came out over the dropdown and "Microfone" over "Não ouvir ninguém".
// That is why both ask for TWO lines and are drawn at `y + LINHA`, and the panel's height comes from the sum below.
const W = 252, PAD = 7, LINHA = 9, GAP = 3, RECADO = 9;
const DICA = ['Nada é gravado: o servidor esquece.', 'O microfone só abre quando você aperta.'];
const ALTURA_DICA = DICA.length * 10 + 3; // ui.tipBox: 10 px per line + 3
// title, state, notice, microphone, mode, volume (label+track), deafen, level (label+bar), "perto de você", list
const LINHAS = [LINHA, LINHA, RECADO, LINHA, 12, LINHA * 2, LINHA, LINHA + 7, LINHA, 46];
const H = 5 + LINHAS.reduce((s, h) => s + h + GAP, 0) + ALTURA_DICA + 6;

export function criarTelaVoz({ estado, captura, playback, aplicar, vizinhos, teclas }) {
  return class TelaVoz {
    /** @param {CanvasRenderingContext2D} _c @param {any} f */
    draw(_c, f) {
      const { ui, state } = f;
      state.modo ??= { open: false };
      state.lista ??= { scroll: 0 };

      const c = ui.center(W, H);
      ui.hit(0, 0, ui.width, ui.height, { kind: 'outside' });
      ui.hit(c.x, c.y, W, H, { kind: 'panel' });
      ui.panel(c.x, c.y, W, H);

      const col = ui.column({ x: c.x + PAD, y: c.y + 5, w: W - PAD * 2, gap: GAP });
      ui.label({ ...col.place(LINHA), text: 'Voz por proximidade', align: 'center' });

      const d = captura.disponivel();
      ui.label({ ...col.place(LINHA), dim: true,
        text: estado.ligada ? `alcance ${estado.raio} blocos · ${d.falar ? 'pode falar' : 'só ouvir'}` : 'desligada neste servidor' });
      // ONE line reserved for the notice, whether there is a notice or not: the rest of the screen cannot dance according to the state
      const recado = col.place(RECADO);
      const porque = !estado.ligada ? estado.motivo : !d.falar ? d.motivo : null;
      if (porque) ui.label({ ...recado, text: cortar(porque, 40), dim: true, lines: [porque] });

      // 1. the microphone
      const mic = col.place(LINHA);
      ui.checkbox({
        x: mic.x, y: mic.y, focus: 'mic', label: 'Microfone ligado', value: estado.micLigado,
        disabled: !estado.ligada || !d.falar,
        onChange: (/** @type {boolean} */ v) => { estado.micLigado = v; if (!v) captura.desligar(); else if (estado.modo === 'aberta') captura.abrir(); },
      });

      // 2. the mode
      const modo = col.place(12);
      ui.dropdown({
        x: modo.x, y: modo.y, w: 140, state: state.modo, value: estado.modo, focus: 'modo',
        options: [ // short labels: the open list has the dropdown's width and the text is not cut off by anyone
          { value: 'aperta', label: `Apertar para falar (${tecla(f)})` },
          { value: 'aberta', label: 'Voz aberta (sempre no ar)' },
        ],
        onPick: (/** @type {string} */ v) => {
          estado.modo = v;
          if (v === 'aberta' && estado.micLigado) captura.abrir();
          else captura.fechar();
        },
      });

      // 3. everyone's volume, and deafen (the slider writes the label ABOVE the y: two lines, draws on the 2nd)
      const vol = col.place(LINHA * 2);
      ui.slider({
        x: vol.x, y: vol.y + LINHA, w: 110, min: 0, max: 100, step: 5, unit: '%', focus: 'volume',
        label: 'Volume', value: Math.round(estado.volume * 100),
        onChange: (/** @type {number} */ v) => { estado.volume = v / 100; },
      });
      const surdo = col.place(LINHA);
      ui.checkbox({
        x: surdo.x, y: surdo.y, focus: 'surdo', label: 'Não ouvir ninguém', value: estado.surdo,
        onChange: (/** @type {boolean} */ v) => { estado.surdo = v; if (v) playback.limpar(); },
      });

      // 4. my level, while I speak (the bar also writes the label above the y)
      const nivel = col.place(LINHA + 7);
      ui.progress({ x: nivel.x, y: nivel.y + LINHA, w: 110, h: 7, value: Math.round(estado.nivel * 100), max: 100,
        label: captura.falando ? 'falando' : 'microfone', text: `${Math.round(estado.nivel * 100)}%` });

      // 5. who is nearby: a button per person to mute just them
      ui.label({ ...col.place(LINHA), text: 'Perto de você', dim: true });
      const nomes = [...new Set([...estado.falando, ...playback.tocando(), ...vizinhos()])].sort();
      const caixa = col.place(46);
      ui.list({
        x: caixa.x, y: caixa.y, w: caixa.w, h: 46, rowH: 12, count: nomes.length, state: state.lista,
        // row(i, rx, ry, over, innerW): the kit delivers the row with scrolling already resolved
        row: (/** @type {number} */ i, /** @type {number} */ rx, /** @type {number} */ ry, /** @type {boolean} */ over, /** @type {number} */ innerW) => {
          const nome = nomes[i];
          if (!nome) return;
          if (over) ui.rect(rx, ry, innerW, 12, ui.theme.slotHover);
          const calado = estado.silenciados.has(nome.toLowerCase());
          ui.label({ x: rx + 3, y: ry + 2, text: cortar(nome, 13), dim: calado });
          const st = playback.estatisticas(nome);
          if (st) ui.label({ x: rx + innerW - 60, y: ry + 2, text: `${st.delayMs} ms`, dim: true });
          ui.iconButton({
            x: rx + innerW - 13, y: ry, size: 12, glyph: calado ? 'x' : 'o',
            // `data` is how the engine identifies the region: it is how the browser suite finds this row's button
            data: { kind: 'silenciar', nome, calado },
            tip: [calado ? `Ouvir ${nome} de novo` : `Silenciar ${nome} (só para você)`],
            onClick: () => {
              const chave = nome.toLowerCase();
              if (calado) estado.silenciados.delete(chave);
              else { estado.silenciados.add(chave); playback.silenciar(nome); }
              aplicar(); // tells the server: it stops spending bandwidth on whom I do not hear
            },
          });
        },
      });

      ui.tip({ x: c.x + PAD, y: c.y + H - ALTURA_DICA - 6, fixed: true, lines: DICA });
    }

    /** @param {any} e */
    onKey(e) {
      if (e.code === 'Escape' || e.action === 'inventory') { e.data.actions.close(); return true; }
      return false;
    }

    /** @param {any} e */
    onPointer(e) {
      if (e.region?.kind === 'outside') { e.data.actions.close(); return true; }
      return true;
    }
  };

  /** The key the player bound to the speak action (or the button on mobile). */
  function tecla(f) {
    const k = teclas();
    return k && k.length ? k[0].replace(/^Key/, '') : f.ui.touch ? 'botão 🎤' : 'sem tecla';
  }
}

const cortar = (texto, n) => (texto.length > n ? `${texto.slice(0, n - 1)}…` : texto);
