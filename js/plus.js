// Pagina Traccemoto Plus: iscrizione alla lista d'attesa (functions/api/lista-attesa.js).
const form = document.getElementById('waitlist');
if (form) {
  const status = document.getElementById('wl-status');
  const say = (text, err = false) => {
    status.textContent = text;
    status.classList.toggle('err', err);
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!form.email.checkValidity() || !email) return say('Scrivi un indirizzo email valido.', true);
    if (!document.getElementById('wl-consent').checked) return say('Serve la tua conferma per poterti scrivere.', true);
    const button = form.querySelector('button');
    button.disabled = true;
    say('Un attimo…');
    try {
      const res = await fetch('/api/lista-attesa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, consenso: true, fonte: 'plus', sito: form.sito.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        form.reset();
        say('Fatto! Ti scriviamo quando Traccemoto Plus apre.');
      } else if (body.errore === 'email') say('Questo indirizzo email non sembra valido.', true);
      else say('Al momento non riesco a registrarti. Riprova più tardi.', true);
    } catch {
      say('Sei offline o il servizio non risponde. Riprova più tardi.', true);
    } finally {
      button.disabled = false;
    }
  });
}
