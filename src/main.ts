// @ts-check
// The entry that runs on BOTH sides, and for that reason keeps only what has to be equal on both:
//   - the channels (the declaration is content: same version on both sides or the channel does not exist);
//   - the two game rules, registered in the SAME ORDER on both sides (it is the ctx.rules contract);
//   - the /voz screen, which is a ScreenHandlerType with no home at all (an options page, not a chest).
// No microphone, no audio and no network here: the `main` entry also runs on the server.
import { GameRuleType, ScreenHandlerType } from './mineclaude-sdk.js';
import { declareChannels, RAIO_PADRAO, RAIO_MAX } from './channels.ts';

/**
 * Is voice on in this world? It is the server OWNER's key: `/gamerule voz_proximidade:voz false` turns it off for
 * everyone, and the server stops relaying a single byte. `sync: true` because the browser needs to know (to tell the
 * player why the microphone does not turn on, instead of seeming broken).
 */
class RegraVoz extends GameRuleType {
  name = 'Voz por proximidade';
  type = 'boolean';
  default = true;
  sync = true;
}

/** How far the voice reaches, in blocks. Also the owner's: a server may want whisper (8) or town square (64). */
class RegraRaio extends GameRuleType {
  name = 'Alcance da voz (blocos)';
  type = 'integer';
  default = RAIO_PADRAO;
  min = 4;
  max = RAIO_MAX;
  sync = true;
}

/** The voice options screen: no item slots, and the player's inventory does not appear below. */
class TelaVoz extends ScreenHandlerType {
  title = 'Voz por proximidade';
  slots = [];
  playerInventory = false;
}

/** @param {any} ctx */
export default function register(ctx) {
  declareChannels(ctx);
  ctx.rules.register('voz', new RegraVoz());
  ctx.rules.register('raio', new RegraRaio());
  ctx.screens.register('voz', new TelaVoz());
}
