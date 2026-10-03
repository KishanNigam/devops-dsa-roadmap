/* Toasts and the reusable confirm dialog (markup lives in index.html). */

const TOAST_MS = 3200;
const ERROR_TOAST_MS = 7000;

export function toast(message, { type = 'info' } = {}) {
  const el = document.createElement('div');
  el.className = type === 'error' ? 'toast toast--error' : 'toast';
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? ERROR_TOAST_MS : TOAST_MS);
}

/**
 * Resolves to 'ok', 'alt' (only when altLabel is given) or 'cancel'.
 * Use confirmDialog for a plain yes/no.
 */
export function chooseDialog({ title, body, confirmLabel = 'Confirm', altLabel = null, danger = false }) {
  const dlg = document.getElementById('confirm-dialog');
  const cancelBtn = dlg.querySelector('button[value="cancel"]');
  const ok = dlg.querySelector('#confirm-ok');

  dlg.querySelector('#confirm-title').textContent = title;
  dlg.querySelector('#confirm-body').textContent = body;

  ok.textContent = confirmLabel;
  ok.classList.toggle('btn--danger', danger);
  ok.classList.toggle('btn--primary', !danger);

  const closeWith = (value) => {
    if (!dlg.open) return;
    dlg.returnValue = value;
    dlg.close();
  };

  cancelBtn.onclick = () => closeWith('cancel');
  ok.onclick = () => closeWith('ok');

  let alt = null;
  if (altLabel) {
    alt = document.createElement('button');
    alt.type = 'button';
    alt.className = 'btn';
    alt.value = 'alt';
    alt.textContent = altLabel;
    alt.onclick = () => closeWith('alt');
    ok.before(alt);
  }

  dlg.returnValue = ''; // otherwise Escape would report the previous dialog's answer
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      cancelBtn.onclick = null;
      ok.onclick = null;
      if (alt) alt.onclick = null;
      alt?.remove();
      resolve(dlg.returnValue === 'ok' ? 'ok' : dlg.returnValue === 'alt' ? 'alt' : 'cancel');
    }, { once: true });
    dlg.showModal();
  });
}

export const confirmDialog = async (options) => (await chooseDialog(options)) === 'ok';
