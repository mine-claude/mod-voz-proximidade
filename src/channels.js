// Generated from channels.ts by "sdk check"/"sdk build": edit the .ts, not this file.
// @ts-check
// The channels of this mod, all in one place: the declaration is CONTENT (the server and the browser must end up with the same
// channel on the same version), so it lives here and each entry — main, server, client — asks for what it needs.
//
// Why the audio goes over a GAME channel and not over WebRTC: in an anarchic server, P2P would hand out the IP address of
// each player to all the others, and would depend on external STUN/TURN. Relaying through the server costs bandwidth, but the
// audio does not leave where the rest of the game already is, and whoever relays can decide — by distance, by room, by
// moderation — before a single byte reaches another person.
//
// The shape of the packets is the mod's bandwidth budget:
//   Opus at 20 kbps, 20 ms frames  ->  ~50 bytes per frame
//   QUADROS_POR_PACOTE = 3            ->  ~150 bytes of audio every 60 ms, or ~17 packets per second
// Grouping is what makes the mod fit: the game connection accepts 80 messages per second (the engine's anti-flood, which a
// `bulk` channel does NOT lift), and one frame per message would spend 50 of them just to talk. Each packet sends 150 bytes of
// audio plus ~110 of envelope and base64, i.e. ~4.4 KB/s from whoever is speaking.
export const QUADROS_POR_PACOTE = 3;
export const QUADRO_MS = 20;
export const BITRATE = 20000;
export const RAIO_PADRAO = 32; // blocks
export const RAIO_MAX = 64;
export const MAX_OUVINTES = 12; // cap on how many people ONE voice is relayed to (the nearest first)
export const MAX_SILENCIADOS = 32; // how many names the browser can ask the server not to send
const NOME = { type: 'string', maxLength: 16 };
const SEQ = { type: 'integer', min: 0, max: 2_000_000_000 };
// A packet: up to QUADROS_POR_PACOTE encoded frames, the first with the number `seq`. 400 bytes per frame leave
// room for someone to raise the bitrate; the channel's cap is what actually limits it.
const PACOTE = { type: 'array', of: { type: 'bytes', maxBytes: 400 }, maxItems: QUADROS_POR_PACOTE + 1 };
/** @param {any} ctx @returns {{ fala: any, ouve: any, ajuste: any, estado: any }} */
export function declareChannels(ctx) {
    return {
        // browser -> server: what I am speaking right now. `bulk` takes this channel out of the engine's global bucket of 20 msg/s
        // and pays the price declared here: 40 packets per second and 8 KB/s per player, which is double what the
        // grouping above spends — enough for a burst when pressing the key, not enough to flood the server.
        fala: ctx.net.channel('fala', {
            version: 1, direction: 'toServer', bulk: true, rate: 40, bytesPerSecond: 8 * 1024, maxBytes: 2048,
            schema: { seq: SEQ, q: PACOTE },
        }),
        // server -> browser: the voice of someone who is near, with the name and position of whoever spoke (the position is that of
        // whoever SPEAKS at the moment of the packet: that is what the browser uses for the 3D audio, and not the last one it saw).
        ouve: ctx.net.channel('ouve', {
            version: 1, direction: 'toClient', bulk: true, bytesPerSecond: 48 * 1024, maxBytes: 2048,
            schema: { de: NOME, seq: SEQ, q: PACOTE, x: 'number', y: 'number', z: 'number' },
        }),
        // browser -> server: what I want (I am speaking; do not send me the voice of these). Telling the server whom I
        // muted is not a matter of trust — the browser does not play it either —, it is bandwidth: the server stops
        // sending what I will not listen to.
        ajuste: ctx.net.channel('ajuste', {
            version: 1, direction: 'toServer', rate: 4, maxBytes: 1024,
            schema: {
                falando: { type: 'boolean', optional: true },
                silenciar: { type: 'array', of: NOME, maxItems: MAX_SILENCIADOS, optional: true },
            },
        }),
        // server -> browser: is voice on in this world? with what radius? who is speaking near me right now?
        estado: ctx.net.channel('estado', {
            version: 1, direction: 'toClient', maxBytes: 1024,
            schema: {
                ligada: 'boolean',
                raio: { type: 'integer', min: 1, max: RAIO_MAX },
                motivo: { type: 'string', maxLength: 80, optional: true },
                falando: { type: 'array', of: NOME, maxItems: 16, default: [] },
            },
        }),
    };
}
