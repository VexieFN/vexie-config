'use strict';

/* Registrazione della lezione:
   - microfono con soppressione rumore/eco del browser
   - catena di filtri "voce" (passa-alto, passa-basso, presenza, compressore) per isolare il parlato
   - classificazione in tempo reale: spiegazione / rumore / silenzio (stima basata sullo spettro)
   - trascrizione live con Web Speech API (se disponibile)
   - salvataggio automatico della bozza ogni 30s (protezione da crash) */
const Recorder = (() => {
  let stream, ctx, analyser, mediaRecorder, recog;
  let chunks = [];
  let mime = '';
  let state = 'idle'; // idle | recording | paused
  let startedAt = 0;
  let accumulated = 0;
  let wantRecog = false;
  let segments = [];
  let interim = '';
  let bookmarks = [];
  let stats = { voice: 0, noise: 0, silence: 0 };
  let noiseFloor = 0.01;
  let lastTick = 0;
  let rafId = 0;
  let wakeLock = null;
  let draftTimer = 0;
  let meta = {};
  let lastKind = 'silence';
  const listeners = {};

  const on = (evt, fn) => {
    (listeners[evt] = listeners[evt] || new Set()).add(fn);
    return () => listeners[evt].delete(fn);
  };
  const emit = (evt, data) => (listeners[evt] || []).forEach((fn) => fn(data));

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const speechSupported = () => !!SR;

  function pickMime() {
    const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    return types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  }

  const elapsed = () => accumulated + (state === 'recording' ? (performance.now() - startedAt) / 1000 : 0);

  async function start(options = {}) {
    if (state !== 'idle') return;
    const { filter = true, live = true, lang = 'it-IT' } = options;
    meta = { ...options, startedAtISO: new Date().toISOString() };

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });

    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    let node = source;

    if (filter) {
      // Taglia rumori bassi (sedie, banchi, ronzii) e alti (fruscii), enfatizza l'intelligibilità della voce.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 100;
      hp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7500;
      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 2600;
      presence.Q.value = 0.9;
      presence.gain.value = 3;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -30;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      node.connect(hp);
      hp.connect(lp);
      lp.connect(presence);
      presence.connect(comp);
      node = comp;
    }

    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    node.connect(analyser);
    const dest = ctx.createMediaStreamDestination();
    node.connect(dest);

    mime = pickMime();
    const recOpts = { audioBitsPerSecond: 24000 }; // ~11 MB/ora: ottimo per la voce e leggero da inviare
    if (mime) recOpts.mimeType = mime;
    try {
      mediaRecorder = new MediaRecorder(dest.stream, recOpts);
    } catch (e) {
      mediaRecorder = new MediaRecorder(dest.stream);
    }
    mime = mediaRecorder.mimeType || mime || 'audio/webm';
    chunks = [];
    mediaRecorder.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    mediaRecorder.start(5000);

    segments = [];
    interim = '';
    bookmarks = [];
    stats = { voice: 0, noise: 0, silence: 0 };
    noiseFloor = 0.01;
    accumulated = 0;
    startedAt = performance.now();
    lastTick = startedAt;
    state = 'recording';

    if (live) startRecognition(lang);
    requestWakeLock();
    draftTimer = setInterval(saveDraft, 30000);
    loop();
    emit('state', state);
  }

  /* ---------- Analisi spettrale: voce vs rumore ---------- */
  function loop() {
    if (!analyser) return;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    const binHz = ctx.sampleRate / analyser.fftSize;

    const tick = () => {
      if (!analyser) return;
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);
      let sum = 0;
      for (let i = 0; i < time.length; i++) {
        const v = (time[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / time.length);

      // Spettro in potenza lineare (i byte dell'analyser sono in dB)
      const minDb = analyser.minDecibels;
      const rangeDb = analyser.maxDecibels - minDb;
      const lo = Math.floor(250 / binHz);
      const hi = Math.floor(3800 / binHz);
      let voiceE = 0;
      let totalE = 0;
      let logSum = 0;
      let n = 0;
      for (let i = 1; i < freq.length; i++) {
        const p = Math.pow(10, (minDb + (freq[i] / 255) * rangeDb) / 10);
        totalE += p;
        if (i >= lo && i < hi) {
          voiceE += p;
          logSum += Math.log(p);
          n++;
        }
      }
      const voiceRatio = totalE ? voiceE / totalE : 0;
      // Piattezza spettrale nella banda vocale: una voce singola ha armoniche (picchi) → valore basso;
      // brusio di tante voci, fruscii e rumori sono più "piatti" → valore alto.
      const flatness = n && voiceE ? Math.exp(logSum / n) / (voiceE / n) : 1;

      const now = performance.now();
      const dt = (now - lastTick) / 1000;
      lastTick = now;

      let kind = 'silence';
      if (state === 'recording') {
        // Rumore di fondo adattivo
        if (rms < noiseFloor * 1.3) noiseFloor = noiseFloor * 0.98 + rms * 0.02;
        else noiseFloor = noiseFloor * 0.9995 + rms * 0.0005;
        noiseFloor = Math.max(0.003, Math.min(noiseFloor, 0.2));

        if (rms > noiseFloor * 1.8 && rms > 0.012) {
          // voce dominante e "armonica" = spiegazione; altrimenti brusio/rumore
          kind = voiceRatio > 0.55 && flatness < 0.35 && rms > noiseFloor * 2.5 ? 'voice' : 'noise';
        }
        // un po' di isteresi per non far "ballare" l'indicatore
        if (kind !== lastKind && kind === 'silence' && lastKind === 'voice' && rms > noiseFloor * 1.3) kind = 'voice';
        lastKind = kind;
        if (dt < 1) stats[kind] += dt;
      }
      emit('level', { rms, kind, voiceRatio, flatness, freq, elapsed: elapsed() });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  /* ---------- Trascrizione live ---------- */
  function startRecognition(lang) {
    if (!SR) {
      emit('recog', { status: 'unsupported' });
      return;
    }
    wantRecog = true;
    recog = new SR();
    recog.lang = lang;
    recog.continuous = true;
    recog.interimResults = true;
    recog.maxAlternatives = 1;
    recog.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0].transcript.trim();
        if (!txt) continue;
        if (r.isFinal) segments.push({ t: Math.max(0, elapsed() - 3), text: txt });
        else interim += (interim ? ' ' : '') + txt;
      }
      emit('transcript', { segments, interim });
    };
    recog.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
        wantRecog = false;
        emit('recog', { status: 'error', error: e.error });
      }
    };
    recog.onend = () => {
      if (wantRecog && state === 'recording') {
        setTimeout(() => {
          try {
            if (wantRecog && state === 'recording') recog.start();
          } catch (err) {
            /* già avviata */
          }
        }, 300);
      }
    };
    try {
      recog.start();
      emit('recog', { status: 'on' });
    } catch (e) {
      emit('recog', { status: 'error', error: e.message });
    }
  }

  function stopRecognition() {
    if (!recog) return;
    try {
      recog.stop();
    } catch (e) {
      /* ignora */
    }
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) {
      /* non supportato */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state !== 'idle' && !wakeLock) requestWakeLock();
  });

  function pause() {
    if (state !== 'recording') return;
    accumulated = elapsed();
    state = 'paused';
    if (mediaRecorder.state === 'recording') mediaRecorder.pause();
    stopRecognition();
    emit('state', state);
  }

  function resume() {
    if (state !== 'paused') return;
    startedAt = performance.now();
    lastTick = startedAt;
    state = 'recording';
    if (mediaRecorder.state === 'paused') mediaRecorder.resume();
    if (wantRecog && recog) {
      try {
        recog.start();
      } catch (e) {
        /* ignora */
      }
    }
    emit('state', state);
  }

  function addBookmark(label = '') {
    if (state === 'idle') return null;
    const b = { t: elapsed(), label };
    bookmarks.push(b);
    emit('bookmark', b);
    return b;
  }

  function transcriptText() {
    return segments.map((s) => `[${U.fmtDuration(s.t)}] ${s.text}`).join('\n');
  }

  function snapshot() {
    return {
      ...meta,
      duration: elapsed(),
      segments: segments.slice(),
      bookmarks: bookmarks.slice(),
      stats: { ...stats },
      mime,
      savedAt: new Date().toISOString(),
    };
  }

  async function saveDraft() {
    if (state === 'idle') return;
    try {
      await Store.draft.save(snapshot(), chunks.length ? new Blob(chunks, { type: mime }) : null);
    } catch (e) {
      console.warn('Bozza non salvata', e);
    }
  }

  function stop() {
    return new Promise((resolve) => {
      if (state === 'idle') return resolve(null);
      const duration = elapsed();
      wantRecog = false;
      stopRecognition();
      clearInterval(draftTimer);
      cancelAnimationFrame(rafId);
      const finish = () => {
        const blob = new Blob(chunks, { type: mime });
        const result = { ...snapshot(), duration, blob };
        cleanup();
        emit('state', state);
        resolve(result);
      };
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = finish;
        try {
          mediaRecorder.requestData();
        } catch (e) {
          /* ignora */
        }
        mediaRecorder.stop();
      } else finish();
    });
  }

  function cleanup() {
    state = 'idle';
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    if (wakeLock) wakeLock.release().catch(() => {});
    stream = ctx = analyser = mediaRecorder = recog = wakeLock = null;
    chunks = [];
  }

  return {
    on, start, pause, resume, stop, addBookmark, transcriptText, supported, speechSupported,
    get state() {
      return state;
    },
    get elapsed() {
      return elapsed();
    },
    get segments() {
      return segments;
    },
    get interim() {
      return interim;
    },
    get bookmarks() {
      return bookmarks;
    },
    get stats() {
      return stats;
    },
    get meta() {
      return meta;
    },
  };
})();
