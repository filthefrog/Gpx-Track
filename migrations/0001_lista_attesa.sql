-- Lista d'attesa di Traccemoto Plus (Cloudflare D1).
-- Si applica dal pannello Cloudflare (D1 › Console) oppure con: wrangler d1 execute traccemoto --file=migrations/0001_lista_attesa.sql
CREATE TABLE IF NOT EXISTS lista_attesa (
  email TEXT PRIMARY KEY,           -- unico dato personale: niente nome, niente IP
  creato TEXT NOT NULL,             -- data e ora dell'iscrizione (ISO 8601, UTC)
  informativa TEXT NOT NULL,        -- versione dell'informativa accettata
  fonte TEXT NOT NULL DEFAULT ''    -- pagina da cui ci si è iscritti (strumento, guida, plus)
);
