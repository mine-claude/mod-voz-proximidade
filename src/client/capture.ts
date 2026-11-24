// @ts-check
// Speaking. Three things happen here, and only here:
//
//  1. THE MICROPHONE ONLY OPENS ON A PLAYER ACTION. `abrir()` is called by the onPress of the input action (the key, or the
//     touch button on mobile) — never in the register, never in a tick. It is the first call that makes the browser
//     ask, and if the person says no the state stays at 'denied' and the mod warns instead of trying again.
//  2. PUSH-TO-TALK is `setPaused`, not `stop`: releasing the key stops delivering frames at once, and the device
//     stays open for FECHAR_MS so the next sentence does not need to reopen. Past that time the device is closed
//     for real (the microphone light goes out). In "open voice" the microphone keeps delivering, and that is why that mode
//     is not the default.
//  3. The frames are GROUPED: QUADROS_POR_PACOTE of 20 ms become one message. It is what makes the voice fit in the 80
//     packets per second that the game connection accepts — and divides the envelope by three.
import { QUADROS_POR_PACOTE, QUADRO_MS, BITRATE } from '../channels.ts';

const FECHAR_MS = 4000; // how long the device stays open after releasing the key

/**
 * @param {any} ctx
 * @param {any} canais the mod's channels
 * @param {any} estado the local state
 */
export function criarCaptura(ctx, canais, estado) {
  let captura = null;
  let fila = [];
  let base = 0; // the sequence number of the first frame in the queue
  let proximo = 0; // the next sequence number to go out
  let falando = false;
  let fecharEm = 0;
  let avisouSemCodec = false;

  const caps = () => ctx.client.media.capabilities();

  function enviar() {
    if (!fila.length) return;
    const q = fila;
    const seq = base;
    fila = [];
    base = proximo;
    if (!canais.fala.canSend()) return; // the server does not have this channel on this version: don't even build the packet
    try { canais.fala.send({ seq, q }); } catch (e) { estado.aviso(`voz: ${e?.message ?? e}`); }
  }

  function quadro(f) {
    if (!falando) return;
    if (!fila.length) base = proximo;
    fila.push(f.bytes);
    proximo++;
    if (fila.length >= QUADROS_POR_PACOTE) enviar();
  }

  /** Creates the capture the first time. Opens nothing: `start()` is what opens. */
  function garantir() {
    if (captura) return captura;
    captura = ctx.client.media.capture({
      name: 'voz', source: 'microphone', codec: 'opus', bitrate: BITRATE, frameMs: QUADRO_MS, channels: 1, sampleRate: 48000,
      onFrame: quadro,
      onLevel: (v) => { estado.nivel = v; },
      onState: (s) => { estado.micEstado = s; if (s === 'denied') estado.aviso('voz: o navegador não deu o microfone (você recusou ou o site não está em HTTPS)'); },
      onError: (e) => estado.aviso(`microfone: ${e?.message ?? e}`),
    });
    return captura;
  }

  const api = {
    /** What this browser can do, in one sentence, for the options screen to show. */
    disponivel() {
      const c = caps();
      return { falar: c.capture && c.microphone && c.encode, ouvir: c.decode, motivo: c.reason };
    },
    get estadoMic() { return captura?.state ?? 'idle'; },
    /** Starts speaking (pressed the key, or turned on open voice). */
    async abrir() {
      if (!estado.ligada) { estado.aviso('a voz está desligada neste servidor'); return false; }
      if (!estado.micLigado) return false; // the player did not turn the microphone on in the screen: the key does not turn it on by itself
      const c = caps();
      if (!c.capture || !c.microphone || !c.encode) {
        if (!avisouSemCodec) { avisouSemCodec = true; estado.aviso(`não dá para falar neste navegador: ${c.reason ?? 'sem captura de áudio'}`); }
        return false;
      }
      fecharEm = 0;
      const cap = garantir();
      falando = true;
      if (cap.state === 'live') { cap.setPaused(false); return true; }
      const ok = await cap.start();
      if (!ok) falando = false;
      return ok;
    },
    /** Stopped speaking (released the key). The device stays open a bit, and then closes. */
    fechar() {
      if (!falando) return;
      falando = false;
      enviar(); // the rest of the sentence goes out before stopping
      fila = [];
      captura?.setPaused(true);
      fecharEm = Date.now() + FECHAR_MS;
      try { if (canais.ajuste.canSend()) canais.ajuste.send({ falando: false }); } catch { /* the channel may have dropped */ }
    },
    /** Closes the device now (left the game, turned the microphone off in the screen). */
    desligar() {
      falando = false;
      fila = [];
      fecharEm = 0;
      estado.nivel = 0;
      captura?.stop();
    },
    get falando() { return falando; },
    /** One game frame: closes the device after FECHAR_MS of silence. */
    passo() {
      if (fecharEm && Date.now() >= fecharEm) { fecharEm = 0; captura?.stop(); }
    },
    estatisticas() { try { return captura?.stats() ?? null; } catch { return null; } },
  };
  return api;
}
