function initChat(root, endpoint) {
  const log = root.querySelector('.log'), input = root.querySelector('textarea'), btn = root.querySelector('button');
  const msgs = [];
  const add = (role, text) => {
    const d = document.createElement('div');
    d.className = 'm ' + role; d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  };
  async function send() {
    const text = input.value.trim(); if (!text) return;
    input.value = ''; msgs.push({ role: 'user', content: text }); add('user', text);
    btn.disabled = true; const w = add('bot', '…');
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Erreur'); }
      const rd = r.body.getReader(), dec = new TextDecoder(); let out = ''; w.textContent = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        out += dec.decode(value, { stream: true }); w.textContent = out; log.scrollTop = log.scrollHeight;
      }
      if (!out) throw new Error('Réponse vide');
      msgs.push({ role: 'assistant', content: out });
    } catch (e) { w.textContent = e.message; w.classList.add('err'); msgs.pop(); }
    btn.disabled = false; input.focus();
  }
  btn.onclick = send;
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}
