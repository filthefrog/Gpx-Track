// Pagina «Convertitore GPX → roadbook»: legge il file nel browser e apre il roadbook (js/roadbook-view.js).
import { mountRoadbookView } from './roadbook-view.js?v=202610041804';

const status = document.getElementById('convert-status');
const say = (text, err = false) => {
  status.textContent = text;
  status.classList.toggle('err', !!err);
};
const view = mountRoadbookView({ notify: say });

async function convert(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) return say('Il file è troppo grande (oltre 30 MB).', true);
  say(`Leggo «${file.name}»…`);
  try {
    if (view.openGpxText(await file.text(), file.name)) say(`Roadbook creato da «${file.name}».`);
  } catch {
    say('Non riesco a leggere il file.', true);
  }
}

const input = document.getElementById('convert-file');
input.addEventListener('change', () => {
  convert(input.files && input.files[0]);
  input.value = '';
});

const drop = document.getElementById('convert-drop');
for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  convert(e.dataTransfer.files && e.dataTransfer.files[0]);
});
