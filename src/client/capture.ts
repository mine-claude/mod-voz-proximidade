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
// OPEN MIC with a threshold: how long the gate stays open after the level drops below it. Without a tail, every
// pause between two words cuts the sentence in half and the other side hears a stutter.
const CAUDA_MS = 700;

/**
 * @param {any} ctx
 * @param {any} canais the mod's channels
 * @param {any} estado the local state
 */
export function criarCaptura(ctx, canais, estado, { aoAbrir = null } = {}) {
  let captura = null;
  let fila = [];
  let base = 0; // the sequence number of the first frame in the queue
  let proximo = 0; // the next sequence number to go out
  let falando = false;
  let fecharEm = 0;
  let avisouSemCodec = false;
  let ativoAte = 0; // open mic: until when the voice-activation gate stays open (see CAUDA_MS)
  let monitorando = false; // "testar microfone": hearing yourself

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

  /**
   * Creates the capture the first time. Opens nothing: `start()` is what opens.
   *
   * The options the PLAYER chose in the options screen go in here: the device, the gain and the browser's three
   * cleanups. The gain and the monitor also change live (`setGain`/`setMonitor`); the device and the three cleanups
   * are `getUserMedia` constraints, and those only change by opening the device again — that is what `recriar()` is
   * for.
   */
  function garantir() {
    if (captura) return captura;
    captura = ctx.client.media.capture({
      name: 'voz', source: 'microphone', codec: 'opus', bitrate: BITRATE, frameMs: QUADRO_MS, channels: 1, sampleRate: 48000,
      deviceId: estado.aparelho ?? undefined,
      gain: estado.ganho, monitor: monitorando,
      noiseSuppression: estado.supressao, echoCancellation: estado.eco, autoGainControl: estado.ganhoAuto,
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
      return { falar: c.capture && c.microphone && c.encode, ouvir: c.decode, listar: c.devices, motivo: c.reason };
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
      // In open mic WITH a threshold the device opens but the gate starts CLOSED: nothing goes out until the player
      // actually speaks. With no threshold (the default) open mic is what it always was — always on the air.
      falando = estado.modo !== 'aberta' || estado.limiar <= 0;
      ativoAte = 0;
      if (cap.state === 'live') { cap.setPaused(false); aoAbrir?.(cap.openedDeviceId()); return true; }
      const ok = await cap.start();
      if (!ok) falando = false;
      else aoAbrir?.(cap.openedDeviceId());
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
      ativoAte = 0;
      estado.nivel = 0;
      // hearing yourself is a test, not a setting: closing the microphone ends it, so nobody is left with the
      // loopback running and no idea where the noise comes from
      monitorando = false;
      captura?.stop();
    },
    get falando() { return falando; },
    /** One game frame: the voice gate of open mic, and closing the device after FECHAR_MS of silence. */
    passo() {
      portao();
      if (fecharEm && Date.now() >= fecharEm) { fecharEm = 0; captura?.stop(); }
    },
    estatisticas() { try { return captura?.stats() ?? null; } catch { return null; } },

    // ---- what the options screen changes ---------------------------------------------------------------------
    /**
     * The microphone gain, 0..3. LIVE: the engine moves one number in the audio graph, the microphone is not
     * reopened and the player is not asked again. It is applied before the encoder, so the level meter moves with it.
     */
    ganho(v) { estado.ganho = v; try { captura?.setGain(v); } catch (e) { estado.aviso(`ganho: ${e?.message ?? e}`); } },

    /**
     * "Testar microfone": hear yourself. Off by default and NOT remembered between sessions — it is feedback on open
     * speakers, and a player who turned it on to test it should not find it on tomorrow.
     */
    monitorar(on) {
      monitorando = !!on;
      try { captura?.setMonitor(monitorando); } catch (e) { estado.aviso(`teste do microfone: ${e?.message ?? e}`); }
      return monitorando;
    },
    get monitorando() { return monitorando; },

    /**
     * The device or one of the browser's cleanups changed: those are `getUserMedia` constraints, so the capture is
     * thrown away and the next `abrir()` builds another one. `close()` and not `stop()`, so the slot goes back to the
     * mod's quota (2 captures per mod) instead of being held by a handle nobody will use again.
     */
    recriar() {
      const estavaVivo = captura?.state === 'live' || captura?.state === 'paused';
      falando = false;
      fila = [];
      fecharEm = 0;
      ativoAte = 0;
      estado.nivel = 0;
      try { captura?.close(); } catch { /* already gone */ }
      captura = null;
      return estavaVivo;
    },
  };

  /**
   * The voice-activation gate of OPEN MIC. The device stays open (it has to, or there is no level to measure) and
   * what this decides is whether the frames go out: above the threshold they do, and they keep going for CAUDA_MS
   * after the level drops, so a breath between two words is not a cut sentence.
   */
  function portao() {
    if (estado.modo !== 'aberta' || !estado.micLigado || estado.limiar <= 0) return;
    if (captura?.state !== 'live') return;
    const agora = Date.now();
    if (estado.nivel >= estado.limiar) ativoAte = agora + CAUDA_MS;
    const quer = agora < ativoAte;
    if (quer === falando) return;
    falando = quer;
    if (!quer) enviar(); // the rest of the sentence goes out before the gate closes
  }

  return api;
}
