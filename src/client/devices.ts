// @ts-check
// WHICH microphone. The engine lists the input devices (`ctx.client.media.devices()`) and warns when one is plugged
// in or pulled out (`onDevicesChange`); this file turns that into the three things the screen needs:
//
//  1. a LIST with names the player can read. The browser only names the devices after the player has allowed the
//     microphone once — before that `label` is empty on purpose, because naming them would be a way of identifying
//     the machine —, so until then they are "Microfone 1", "Microfone 2", with a line saying why.
//  2. the CHOICE, which is a `deviceId` and gets saved in this browser. The ids are per site and per session: the one
//     saved yesterday may be gone today.
//  3. WHAT TO DO when the chosen one disappears: go back to the default and SAY SO. A headset pulled out must not
//     leave the player talking into a microphone that is not there, and it must not leave the screen showing a device
//     that no longer exists.
//
// Nothing here opens a microphone. The device is opened by `capture.ts`, from a key the player pressed.

/**
 * @param {any} ctx
 * @param {any} estado the mod's local state
 * @param {{ aoTrocar: (motivo: string | null) => void }} ganchos what to do when the chosen device changed under us
 */
export function criarAparelhos(ctx, estado, { aoTrocar }) {
  /** @type {{ deviceId: string, label: string, isDefault: boolean }[]} */
  let lista = [];
  let lendo = false;
  let temNomes = false; // the browser has already given at least one real name (i.e. permission has been granted)
  let pararDeOuvir = null;

  const podeListar = () => !!ctx.client.media.capabilities().devices;

  /** The name to show for one device, with the fallback for a browser that has not named them yet. */
  const nomeDe = (d, i) => {
    if (d.label) return d.label;
    return d.isDefault ? 'Microfone padrão' : `Microfone ${i + 1}`;
  };

  const api = {
    /** The devices as the screen draws them: `{ id, nome, padrao }`, with the default one first. */
    lista() {
      return lista.map((d, i) => ({ id: d.deviceId, nome: nomeDe(d, i), padrao: d.isDefault }));
    },
    /** Do the names mean anything yet? The screen says "permita o microfone para ver os nomes" while this is false. */
    temNomes() { return temNomes; },
    podeListar,

    /**
     * Asks the browser for the list again. Safe to call from a click, from the screen opening and from a
     * `devicechange` — one read at a time, and a failure leaves the previous list standing.
     */
    async revisar() {
      if (!podeListar() || lendo) return api.lista();
      lendo = true;
      try {
        const nova = await ctx.client.media.devices();
        lista = nova.map((d) => ({ deviceId: d.deviceId, label: d.label, isDefault: d.isDefault }));
        // the default one first: it is the one most players will use, and the one the mod falls back to
        lista.sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
        if (lista.some((d) => d.label)) temNomes = true;
        // the chosen device vanished (unplugged, or an id saved in another session): back to the default, with a word
        if (estado.aparelho && !lista.some((d) => d.deviceId === estado.aparelho)) {
          estado.aparelho = null;
          aoTrocar('o seu microfone saiu: voltei para o padrão');
        }
      } catch (e) { console.warn(`[voz_proximidade] aparelhos: ${e?.message ?? e}`); }
      finally { lendo = false; }
      return api.lista();
    },

    /** The player picked one in the screen (`null` = the browser's default). */
    escolher(id) {
      const novo = id && lista.some((d) => d.deviceId === id) ? id : null;
      if (novo === estado.aparelho) return false;
      estado.aparelho = novo;
      aoTrocar(null); // not a failure: the microphone has to be reopened on the new device
      return true;
    },

    /** The name of what is chosen, for the screen's dropdown to show when it is closed. */
    nomeEscolhido() {
      if (!estado.aparelho) return 'Padrão do navegador';
      const i = lista.findIndex((d) => d.deviceId === estado.aparelho);
      return i < 0 ? 'Padrão do navegador' : nomeDe(lista[i], i);
    },

    /**
     * Which microphone is really OPEN, compared with what was asked for. The browser may have opened another one (an
     * id from another session), and then the screen says so instead of showing the wrong device.
     */
    conferirAberto(aberto) {
      if (!aberto || !estado.aparelho || aberto === estado.aparelho) return;
      estado.aparelho = lista.some((d) => d.deviceId === aberto) ? aberto : null;
      aoTrocar('o microfone escolhido não existe mais: abri o padrão');
    },

    /** Starts watching for devices being plugged in and out. Gives back the function that stops. */
    ouvir() {
      if (pararDeOuvir || !podeListar()) return;
      pararDeOuvir = ctx.client.media.onDevicesChange(() => { void api.revisar(); });
    },
    parar() { pararDeOuvir?.(); pararDeOuvir = null; },
  };
  return api;
}
