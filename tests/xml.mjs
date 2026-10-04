// Controllo minimale di XML ben formato (sufficiente per i GPX generati), senza dipendenze.
// Restituisce un albero { name, attrs, children, text } o lancia un errore con la posizione.
export function parseXml(src) {
  let i = 0;
  const fail = (msg) => {
    const line = src.slice(0, i).split('\n').length;
    throw new Error(`XML non valido alla riga ${line}: ${msg}`);
  };
  const NAME = /[A-Za-z_][\w.:-]*/y;
  const readName = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(src);
    if (!m) fail('nome atteso');
    i += m[0].length;
    return m[0];
  };
  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const checkText = (t) => {
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t)) fail('& non escapato');
    return t
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  };

  if (src.startsWith('<?xml')) {
    const end = src.indexOf('?>');
    if (end < 0) fail('dichiarazione non chiusa');
    i = end + 2;
  }
  skipWs();
  const root = { children: [] };
  const stack = [root];
  while (i < src.length) {
    if (src[i] === '<') {
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i);
        if (end < 0) fail('commento non chiuso');
        i = end + 3;
        continue;
      }
      if (src[i + 1] === '/') {
        i += 2;
        const name = readName();
        skipWs();
        if (src[i] !== '>') fail('> atteso');
        i++;
        const el = stack.pop();
        if (!el || el.name !== name) fail(`chiusura </${name}> inattesa`);
        continue;
      }
      i++;
      const el = { name: readName(), attrs: {}, children: [], text: '' };
      for (;;) {
        skipWs();
        if (src[i] === '/' && src[i + 1] === '>') {
          i += 2;
          stack[stack.length - 1].children.push(el);
          break;
        }
        if (src[i] === '>') {
          i++;
          stack[stack.length - 1].children.push(el);
          stack.push(el);
          break;
        }
        const an = readName();
        skipWs();
        if (src[i] !== '=') fail('= atteso');
        i++;
        skipWs();
        const q = src[i];
        if (q !== '"' && q !== "'") fail('virgolette attese');
        const end = src.indexOf(q, i + 1);
        if (end < 0) fail('attributo non chiuso');
        const v = src.slice(i + 1, end);
        if (v.includes('<')) fail('< in un attributo');
        if (an in el.attrs) fail(`attributo ${an} duplicato`);
        el.attrs[an] = checkText(v);
        i = end + 1;
      }
    } else {
      const end = src.indexOf('<', i);
      const t = src.slice(i, end < 0 ? src.length : end);
      if (stack.length === 1 && t.trim()) fail('testo fuori dalla radice');
      if (stack.length > 1) stack[stack.length - 1].text += checkText(t);
      i = end < 0 ? src.length : end;
    }
  }
  if (stack.length !== 1) fail(`elemento <${stack[stack.length - 1].name}> non chiuso`);
  if (root.children.length !== 1) fail('serve un solo elemento radice');
  return root.children[0];
}

export function findAll(el, name, out = []) {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function child(el, name) {
  return el.children.find((c) => c.name === name);
}
