// @ts-check
// Listening: each person who speaks nearby gets ONE stream from ctx.audio (`bus.stream`), positioned where they are, and the
// frames that arrive are pushed into it. The volume falls with distance because the stream is a spatial voice like
// any other from the SDK — this file computes no attenuation, it only states the position; the PannerNode and the radius do
// the rest, and the `voz` channel with `environment: true` puts the voice in the same acoustics as the place (cave, water, field).
//
// The jitter buffer lives inside the stream (shared/modloader/audio-stream.js): this file neither orders nor waits for
// anything, it just delivers each frame with its sequence number.
import { QUADRO_MS } from '../channels.ts';

const MAX_VOZES = 8; // how many people are played at the same time (the ones that arrived first)
const ESQUECER_MS = 1500; // without a packet for that time, the stream is closed (and her microphone, released here)

/**
 * @param {any} ctx
 * @param {any} estado the mod's local state (client/index.js)
 */
export function criarPlayback(ctx, estado) {
  /** @type {Map<string, { stream: any, visto: number }>} */
  const vozes = new Map();
  let bus = null;
  let aviso = false;

  const agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // o volume de todos vezes o DESTA pessoa (0 a 200%). O teto é o do motor para UM stream (4): o mod nunca chega
  // lá — 1 × 2 —, mas quem lê este arquivo não precisa ir conferir o limite do outro lado para ter certeza.
  const volumeDe = (nome) => Math.min(4, estado.volume * (estado.volumes.get(nome.toLowerCase()) ?? 1));

  /** This mod's audio channel, created on the first voice: before that there is no AudioContext to spend. */
  function canal() {
    if (!bus) bus = ctx.audio.bus('voz', { volume: 1, environment: true });
    return bus;
  }

  function fechar(nome) {
    const v = vozes.get(nome);
    if (!v) return;
    vozes.delete(nome);
    try { v.stream.stop(); } catch { /* already gone */ }
  }

  return {
    /** A packet from the `ouve` channel: the name, the position of whoever spoke and the frames. */
    receber(d) {
      if (!estado.ligada || estado.surdo) return;
      const chave = d.de.toLowerCase();
      if (estado.silenciados.has(chave)) return; // muted here too, even if the server still sends it
      if (!d.q.length) return;
      let v = vozes.get(d.de);
      if (!v) {
        if (vozes.size >= MAX_VOZES) return;
        const caps = ctx.audio.capabilities();
        if (!caps.streams || !caps.streamCodecs.includes('opus')) {
          if (!aviso) { aviso = true; estado.aviso('este navegador não decodifica Opus: não dá para ouvir a voz'); }
          return;
        }
        let stream;
        try {
          stream = canal().stream({
            name: 'voz', codec: 'opus', frameMs: QUADRO_MS, jitterMs: 60,
            sampleRate: 48000, channels: 1, radius: estado.raio,
            position: { x: d.x, y: d.y, z: d.z }, volume: volumeDe(d.de),
          });
        } catch (e) { estado.aviso(`voz de ${d.de}: ${e?.message ?? e}`); return; }
        vozes.set(d.de, (v = { stream, visto: 0 }));
      }
      v.visto = agora();
      v.stream.setPosition({ x: d.x, y: d.y, z: d.z });
      for (let i = 0; i < d.q.length; i++) v.stream.push(d.q[i], { seq: d.seq + i });
    },
    /** Called every frame: closes whoever stopped speaking and applies the volume the player chose. */
    passo() {
      const t = agora();
      for (const [nome, v] of [...vozes]) {
        if (t - v.visto > ESQUECER_MS) { fechar(nome); continue; }
        try { v.stream.setVolume(volumeDe(nome)); } catch { /* the stream already stopped */ }
      }
    },
    /** Who is playing now (for the HUD and the screen). */
    tocando() { return [...vozes.keys()]; },
    /** The buffer state of a voice, for the options screen to show delay and losses. */
    estatisticas(nome) { try { return vozes.get(nome)?.stream.stats() ?? null; } catch { return null; } },
    silenciar(nome) { fechar(nome); },
    limpar() { for (const nome of [...vozes.keys()]) fechar(nome); },
  };
}
