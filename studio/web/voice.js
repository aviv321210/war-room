// War Room: talking by voice to the people near you. Hold V and whoever stands within earshot hears you, louder
// the closer they are; nobody further away does. Sound goes straight from PC to PC (WebRTC on the local network,
// no server of anybody in between); only the few small set-up messages travel through the game relay.
// Voice is for people: the agents of the arena react to typed /say only, never to what is spoken.
// What a coworker sends here is checked: it can open a sound connection to this window and nothing else.
export function initVoice(W, Town) {
  const { me, AC, peersV, floorEl } = W;
  const load = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
  const HEAR = Town.HEAR, NEAR = 4, LINK_IN = HEAR + 10, LINK_OUT = HEAR + 22, MAX_LINKS = 12;
  const ok = typeof RTCPeerConnection === 'function' && !!navigator.mediaDevices?.getUserMedia;
  let mode = ['ptt', 'open', 'off'].includes(load('wr-voice', 'ptt')) ? load('wr-voice', 'ptt') : 'ptt';   // push to talk | open microphone | off
  let stream = null, track = null, asking = false, denied = false, holding = false, lastState = '', stateAt = 0, tickAt = 0, ctx = null;
  const links = new Map();        // player id -> { pc, audio, level, queued, born, connected }
  const cool = new Map();         // player id -> do not try again before
  const on = () => ok && mode !== 'off';
  const talkingNow = () => !!track && (mode === 'open' || holding);
  const sig = (to, d) => W.netSend({ type: 'g', k: 'vc.sig', to: [to], d });
  const audioCtx = () => { try { ctx ??= new AudioContext(); if (ctx.state === 'suspended') ctx.resume().catch(() => {}); } catch { ctx = null; } return ctx; };

  // the microphone: asked for the first time you want to talk (the browser shows its own question)
  async function getMic() {
    if (track || asking || !ok) return !!track;
    asking = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      track = stream.getAudioTracks()[0] ?? null;
      if (track) { track.enabled = talkingNow(); track.onended = () => { track = null; stream = null; sendState(true); }; for (const L of links.values()) L.tx?.sender.replaceTrack(track).catch(() => {}); }
      denied = false;
    } catch { denied = true; AC.toast('No microphone: Windows or the browser did not allow it. You can still hear the others.', 'warn'); }
    asking = false;
    sendState(true); paint();
    return !!track;
  }
  function dropMic() { for (const L of links.values()) L.tx?.sender.replaceTrack(null).catch(() => {}); stream?.getTracks().forEach((t) => t.stop()); stream = null; track = null; }
  function setMode(m) {
    if (!ok) return AC.toast('Voice does not work in this window.', 'warn');
    mode = m; store('wr-voice', m);
    if (m === 'off') { dropMic(); for (const id of [...links.keys()]) drop(id); }
    else if (m === 'open') getMic();
    if (track) track.enabled = talkingNow();
    sendState(true); paint();
    AC.toast(m === 'off' ? 'Voice is off: you hear nobody and nobody hears you.' : m === 'open' ? `Microphone open: everybody within ${HEAR} m hears you all the time.` : `Hold V to talk to the people within ${HEAR} m.`);
  }
  function hold(v) {
    if (!on() || mode !== 'ptt' || holding === v) return;
    holding = v;
    if (v && !track) getMic();
    if (track) track.enabled = talkingNow();
    paint();
  }
  addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'v' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !W.busy() && W.isVisible()) hold(true); });
  addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'v') hold(false); });
  addEventListener('blur', () => hold(false));

  // ---- one sound connection per person in earshot ----
  function meter(L, ms) {
    const c = audioCtx(); if (!c) return;
    try { L.an = c.createAnalyser(); L.an.fftSize = 1024; c.createMediaStreamSource(ms).connect(L.an); L.buf = new Uint8Array(L.an.fftSize); } catch { L.an = null; }
  }
  const measure = (L) => { if (L.an) { L.an.getByteTimeDomainData(L.buf); let s = 0; for (const v of L.buf) s += (v - 128) * (v - 128); L.level = Math.max(Math.sqrt(s / L.buf.length) / 128, L.level * 0.92); } return L.level; };      // the loudest of the last moments
  function link(id) {
    const pc = new RTCPeerConnection({ iceServers: [] });       // the local network only
    const L = { pc, audio: new Audio(), level: 0, queued: [], born: performance.now(), connected: false, tx: null, an: null };
    L.audio.autoplay = true; L.audio.volume = 0;
    pc.onicecandidate = (e) => { if (e.candidate) sig(id, { ice: e.candidate.toJSON() }); };
    pc.ontrack = (e) => { const ms = e.streams[0] ?? new MediaStream([e.track]); L.audio.srcObject = ms; L.audio.play().catch(() => {}); meter(L, ms); };
    pc.onconnectionstatechange = () => { L.connected = pc.connectionState === 'connected'; if (['failed', 'closed'].includes(pc.connectionState)) drop(id, 8000); };
    links.set(id, L);
    return L;
  }
  function drop(id, wait = 0) {
    const L = links.get(id); if (!L) return;
    links.delete(id);
    try { L.pc.onconnectionstatechange = null; L.pc.close(); } catch { /* closed */ }
    L.audio.srcObject = null;
    if (wait) cool.set(id, performance.now() + wait);
  }
  async function call(id) {                         // the side with the lower id makes the offer
    const L = link(id);
    try {
      L.tx = L.pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (track) await L.tx.sender.replaceTrack(track);
      await L.pc.setLocalDescription(await L.pc.createOffer());
      sig(id, { sdp: { type: 'offer', sdp: L.pc.localDescription.sdp } });
    } catch { drop(id, 8000); }
  }
  async function onSig(p, d) {
    if (!on()) return;
    try {
      if (d.sdp && typeof d.sdp.sdp === 'string' && d.sdp.sdp.length < 5500 && ['offer', 'answer'].includes(d.sdp.type)) {
        if (d.sdp.type === 'offer') {
          if (W.myId() < p.id) return;                 // offers come from the lower id only
          if (!wanted(p, true)) return;
          drop(p.id);
          const L = link(p.id);
          await L.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp.sdp });
          L.tx = L.pc.getTransceivers()[0] ?? null;
          if (L.tx) { L.tx.direction = 'sendrecv'; if (track) await L.tx.sender.replaceTrack(track); }
          await L.pc.setLocalDescription(await L.pc.createAnswer());
          sig(p.id, { sdp: { type: 'answer', sdp: L.pc.localDescription.sdp } });
          for (const c of L.queued.splice(0)) L.pc.addIceCandidate(c).catch(() => {});
        } else {
          const L = links.get(p.id);
          if (!L || L.pc.signalingState !== 'have-local-offer') return;
          await L.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp.sdp });
          for (const c of L.queued.splice(0)) L.pc.addIceCandidate(c).catch(() => {});
        }
      } else if (d.ice && typeof d.ice.candidate === 'string' && d.ice.candidate.length < 400) {
        const L = links.get(p.id); if (!L) return;
        const c = { candidate: d.ice.candidate, sdpMid: typeof d.ice.sdpMid === 'string' ? d.ice.sdpMid.slice(0, 16) : null, sdpMLineIndex: Number.isInteger(d.ice.sdpMLineIndex) ? d.ice.sdpMLineIndex : null };
        if (L.pc.remoteDescription) L.pc.addIceCandidate(c).catch(() => {}); else if (L.queued.length < 30) L.queued.push(c);
      }
    } catch { drop(p.id, 8000); }
  }
  const dist = (p) => (p.avatar?.shown && me.fig ? Math.hypot(p.avatar.x - me.x, p.avatar.z - me.z) : Infinity);
  // a connection is worth having when we are close and at least one of us has a microphone on
  const wanted = (p, linked) => on() && !!p.voice?.on && (!!track || !!p.voice.mic) && dist(p) < (linked ? LINK_OUT : LINK_IN);
  function sendState(force) {
    const s = JSON.stringify({ on: on(), mic: !!track });
    if (!force && s === lastState && performance.now() - stateAt < 6000) return;
    lastState = s; stateAt = performance.now();
    W.netSend({ type: 'g', k: 'vc.st', d: JSON.parse(s) });
  }
  function onGame(p, k, d) {
    if (k === 'vc.st') { p.voice = { on: !!d.on, mic: !!d.mic }; if (!p.voice.on) drop(p.id); }
    else if (k === 'vc.sig') onSig(p, d);
  }
  function update(now) {
    if (!ok) return;
    sendState(false);
    // loudness by distance, every frame, so that walking away fades somebody out smoothly
    for (const [id, L] of links) {
      const p = peersV.get(id), d = p ? dist(p) : Infinity;
      const want = d <= NEAR ? 1 : Math.max(0, 1 - (d - NEAR) / (HEAR - NEAR));
      L.audio.volume += (want - L.audio.volume) * 0.2;
      measure(L);
    }
    if (now - tickAt < 400) return;
    tickAt = now;
    for (const [id, L] of links) {
      const p = peersV.get(id);
      if (!p || !wanted(p, true)) { drop(id); continue; }
      if (!L.connected && now - L.born > 15000) { drop(id, 10000); continue; }
    }
    if (on() && links.size < MAX_LINKS) {
      const near = [...peersV.values()].filter((p) => !links.has(p.id) && W.myId() < p.id && wanted(p, false) && (cool.get(p.id) ?? 0) < now).sort((a, b) => dist(a) - dist(b));
      for (const p of near.slice(0, MAX_LINKS - links.size)) call(p.id);
    }
    paint();
  }

  // ---- the little chip in the corner ----
  const chip = document.createElement('div'); chip.className = 'voice-chip'; floorEl.append(chip);
  chip.onclick = () => setMode(mode === 'ptt' ? 'open' : mode === 'open' ? 'off' : 'ptt');
  chip.title = 'Voice: click to switch between hold-V-to-talk, open microphone and off';
  function paint() {
    chip.hidden = !ok || !W.isVisible() || !peersV.size;
    if (chip.hidden) return;
    const heard = [...links.values()].filter((L) => L.connected).length;
    const s = mode === 'off' ? 'Voice off' : denied ? 'Voice: no microphone, listening only' : mode === 'open' ? (track ? 'Microphone open' : 'Microphone: allow it in the browser') : holding && track ? 'Talking...' : 'Hold V to talk';
    const t = `${s}${mode !== 'off' && heard ? ` &middot; ${heard} in earshot` : ''}`;
    if (chip.dataset.t !== t) { chip.innerHTML = t; chip.dataset.t = t; }
    chip.classList.toggle('live', talkingNow());
  }
  function command(arg) {
    const a = String(arg ?? '').toLowerCase();
    if (a === 'off') return setMode('off');
    if (a === 'open' || a === 'on') return setMode('open');
    if (a === 'ptt' || a === 'push' || a === 'v') return setMode('ptt');
    setMode(mode === 'off' ? 'ptt' : 'off');
  }
  window.WRVoice = { setMode, hold, getMic, state: () => ({ ok, mode, mic: !!track, denied, talking: talkingNow(), links: [...links].map(([id, L]) => ({ who: peersV.get(id)?.name, state: L.pc.connectionState, vol: +L.audio.volume.toFixed(2), level: +measure(L).toFixed(3) })) }) };
  return { update, onGame, onJoin: (p) => { stateAt = 0; }, onLeave: (p) => drop(p.id), command, talking: (id) => { const L = links.get(id); return !!L && L.connected && L.level > 0.02 && L.audio.volume > 0.05; } };
}
