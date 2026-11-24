// @ts-check
// The HUD indicator: a microphone drawn PIXEL BY PIXEL here (the mod's art, no outside image) and the names
// of whoever is speaking nearby. The piece goes in right after the hotbar (`hud.addAfter('hotbar', ...)`), so it
// follows the game's layout at any scale and leaves along with the HUD when the player hides it.
//
// The indicator is mandatory by design decision: an open microphone with nothing on screen is the kind of thing a
// game should not have. It shows TWO states — your microphone (lit while you speak, with the level) and who is
// speaking around you.

// 5 x 8 pixels: the capsule, the stem and the base. '#' is the full colour, '+' the shadow, '.' empty.
const MIC = [
  '.###.',
  '.#+#.',
  '.#+#.',
  '.#+#.',
  '#...#',
  '#...#',
  '.###.',
  '..#..',
];

/** @param {CanvasRenderingContext2D} c */
function desenharMic(c, x, y, px, cor, sombra) {
  for (let r = 0; r < MIC.length; r++) {
    for (let k = 0; k < MIC[r].length; k++) {
      const ch = MIC[r][k];
      if (ch === '.') continue;
      c.fillStyle = ch === '#' ? cor : sombra;
      c.fillRect(x + k * px, y + r * px, px, px);
    }
  }
}

/**
 * @param {any} ctx
 * @param {any} estado
 * @param {any} captura
 * @param {any} playback
 */
export function registrarHud(ctx, estado, captura, playback) {
  // What this piece shows changes BY ITSELF (the microphone level, who started and stopped speaking), and the GUI layer only
  // redraws when someone dirties it. `animates` is how a piece tells the engine that — without it the indicator only
  // appeared when some other HUD thing ordered a redraw, i.e. almost never.
  // `desenhou` keeps whether the last frame showed something: when there is nothing left to show there is still ONE frame left to
  // erase what stayed drawn, and that is what this line ensures.
  let desenhou = false;
  const mostrando = () => {
    const m = captura.estadoMic;
    return m === 'live' || m === 'paused' || m === 'starting'
      || estado.falando.length > 0 || playback.tocando().length > 0 || (!estado.ligada && estado.micLigado);
  };
  ctx.ui.gui.hud.addAfter('hotbar', 'voz', (/** @type {CanvasRenderingContext2D} */ c, /** @type {any} */ f) => {
    const px = f.hud?.layout?.px ?? f.scale ?? 1;
    const x = 4 * px;
    let y = Math.round(f.height / 2);

    // My microphone: lit when speaking, dark when open-but-silent, nothing when closed.
    const estadoMic = captura.estadoMic;
    if (estadoMic === 'live' || estadoMic === 'paused' || estadoMic === 'starting') {
      const ativo = captura.falando && estadoMic === 'live';
      desenharMic(c, x, y, px, ativo ? '#7ddc6b' : '#8a8a8a', ativo ? '#2f7a28' : '#4a4a4a');
      if (ativo) { // the level, in a little bar beside it: you can see the microphone is hearing you
        const h = Math.max(1, Math.round(8 * px * Math.min(1, estado.nivel)));
        c.fillStyle = '#7ddc6b';
        c.fillRect(x + 7 * px, y + 8 * px - h, 2 * px, h);
      }
      y += 11 * px;
    }

    // Who is speaking nearby: what the server said, plus what is already playing here.
    const nomes = [...new Set([...estado.falando, ...playback.tocando()])].slice(0, 5);
    for (const nome of nomes) {
      if (estado.silenciados.has(nome.toLowerCase())) continue;
      desenharMic(c, x, y, px, '#ffd166', '#a8782a');
      f.font.drawText(c, nome, x + 7 * px, y + px, { px, color: '#ffffff' });
      y += 10 * px;
    }

    // Voice off on the server only appears when the player tried to speak: it is not a permanent on-screen warning.
    if (!estado.ligada && estado.micLigado) f.font.drawText(c, 'voz desligada', x, y, { px, color: '#e07b7b' });
    desenhou = mostrando();
  }, { animates: () => mostrando() || desenhou });
}
