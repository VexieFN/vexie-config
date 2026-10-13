'use strict';

/* Client per la Google Gemini API (REST, direttamente dal browser con la API key dell'utente). */
const Gemini = (() => {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
  const INLINE_LIMIT = 14 * 1024 * 1024; // oltre questa dimensione l'audio viene caricato con la File API
  const FALLBACK_MODEL = 'gemini-2.5-flash';
  let autoModel = null;

  function apiKey(k) {
    const key = (k || Store.settings().apiKey || '').trim();
    if (!key) {
      const e = new Error('Manca la API key di Google Gemini. Inseriscila nelle Impostazioni ⚙️');
      e.code = 'NO_KEY';
      throw e;
    }
    return key;
  }

  function friendlyError(status, msg) {
    const m = msg || '';
    if (/API key not valid|API_KEY_INVALID/i.test(m)) return 'API key non valida. Controllala nelle Impostazioni.';
    if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(m))
      return 'Limite di richieste raggiunto (quota gratuita). Aspetta un minuto e riprova.';
    if (status === 404 && /model/i.test(m)) return 'Modello non disponibile: scegline un altro nelle Impostazioni.';
    if (status === 403) return 'Accesso negato dalla API (403). Verifica che la key abbia la Gemini API abilitata.';
    if (status >= 500) return 'I server di Google sono sovraccarichi in questo momento. Riprova tra poco.';
    return m || `Errore ${status}`;
  }

  async function request(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('Connessione assente o bloccata. Controlla internet.');
    }
    if (!res.ok) {
      let msg = '';
      try {
        const j = await res.json();
        msg = j.error && j.error.message;
      } catch (e) {
        /* niente */
      }
      const err = new Error(friendlyError(res.status, msg));
      err.status = res.status;
      err.raw = msg;
      throw err;
    }
    return res;
  }

  async function listModels(key) {
    const k = apiKey(key);
    const res = await request(`${BASE}/models?pageSize=200&key=${encodeURIComponent(k)}`);
    const j = await res.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
      .filter((m) => /gemini|gemma/i.test(m.id) && !/tts|image|embedding|live|audio|robotics|computer/i.test(m.id));
  }

  /* Sceglie automaticamente il miglior modello "flash" disponibile per la key. */
  function pickBest(ids) {
    if (ids.includes('gemini-flash-latest')) return 'gemini-flash-latest';
    const ver = (id) => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
    const stable = ids.filter((id) => /^gemini-\d+(\.\d+)?-flash$/.test(id)).sort((a, b) => ver(b) - ver(a));
    if (stable.length) return stable[0];
    const flash = ids.filter((id) => /flash/.test(id) && !/lite|8b/.test(id)).sort((a, b) => ver(b) - ver(a));
    return flash[0] || ids[0] || FALLBACK_MODEL;
  }

  async function model() {
    const s = Store.settings();
    if (s.model && s.model !== 'auto') return s.model;
    if (autoModel) return autoModel;
    try {
      autoModel = pickBest((await listModels()).map((m) => m.id));
    } catch (e) {
      if (e.code === 'NO_KEY' || e.status === 400) throw e;
      autoModel = FALLBACK_MODEL;
    }
    return autoModel;
  }

  function resetModelCache() {
    autoModel = null;
  }

  function buildBody({ contents, system, json, schema, temperature = 0.6, maxTokens }) {
    const body = { contents, generationConfig: { temperature } };
    if (maxTokens) body.generationConfig.maxOutputTokens = maxTokens;
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (json) {
      body.generationConfig.responseMimeType = 'application/json';
      if (schema) body.generationConfig.responseSchema = schema;
    }
    return body;
  }

  function extractText(j) {
    const c = j.candidates && j.candidates[0];
    if (!c) {
      const why = j.promptFeedback && j.promptFeedback.blockReason;
      throw new Error(why ? `Richiesta bloccata dai filtri di sicurezza (${why}).` : 'Risposta vuota dalla AI.');
    }
    const text = ((c.content && c.content.parts) || [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('');
    return { text, finish: c.finishReason };
  }

  async function generate(opts) {
    const k = apiKey();
    const m = await model();
    const res = await request(`${BASE}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(k)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(opts)),
      signal: opts.signal,
    });
    return extractText(await res.json());
  }

  /* Streaming SSE: chiama onText(testoParziale) man mano che arriva la risposta. */
  async function stream(opts, onText) {
    const k = apiKey();
    const m = await model();
    const res = await request(
      `${BASE}/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(k)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(opts)),
        signal: opts.signal,
      }
    );
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j.error) throw new Error(j.error.message);
          const c = j.candidates && j.candidates[0];
          const parts = (c && c.content && c.content.parts) || [];
          const t = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
          if (t) {
            full += t;
            onText(full);
          }
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }
    if (!full) throw new Error('La AI non ha risposto. Riprova.');
    return full;
  }

  /* Upload con la File API (per audio lunghi). */
  async function uploadFile(blob, mime, displayName, onStatus) {
    const k = apiKey();
    onStatus && onStatus('Carico l\'audio sui server di Google…');
    const start = await request(`${UPLOAD}?key=${encodeURIComponent(k)}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(blob.size),
        'X-Goog-Upload-Header-Content-Type': mime,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    });
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Upload non disponibile da questo browser');
    const up = await request(uploadUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
      body: blob,
    });
    let file = (await up.json()).file;
    for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {
      onStatus && onStatus('Google sta preparando l\'audio…');
      await new Promise((r) => setTimeout(r, 2500));
      file = await (await request(`${BASE}/${file.name}?key=${encodeURIComponent(k)}`)).json();
    }
    if (file.state === 'FAILED') throw new Error('Google non è riuscito a leggere il file audio');
    return { fileData: { mimeType: file.mimeType || mime, fileUri: file.uri } };
  }

  function cleanMime(mime) {
    const m = (mime || 'audio/webm').split(';')[0].trim();
    if (m === 'video/webm') return 'audio/webm';
    if (m === 'audio/x-m4a' || m === 'audio/m4a') return 'audio/mp4';
    if (m === 'audio/mpeg3' || m === 'audio/x-mp3') return 'audio/mp3';
    return m;
  }

  async function pdfPart(blob, onStatus) {
    if (blob.size > 48 * 1024 * 1024) throw new Error('PDF troppo grande (max 50 MB). Dividilo in parti più piccole.');
    if (blob.size <= INLINE_LIMIT) {
      onStatus && onStatus('Preparo il PDF…');
      return { inlineData: { mimeType: 'application/pdf', data: await U.blobToBase64(blob) } };
    }
    return uploadFile(blob, 'application/pdf', 'documento-' + Date.now(), onStatus);
  }

  async function audioPart(blob, onStatus) {
    const mime = cleanMime(blob.type);
    if (blob.size <= INLINE_LIMIT) {
      onStatus && onStatus('Preparo l\'audio…');
      return { inlineData: { mimeType: mime, data: await U.blobToBase64(blob) } };
    }
    return uploadFile(blob, mime, 'lezione-' + Date.now(), onStatus);
  }

  /* ---------- Analisi della lezione ---------- */
  const S = (type, extra = {}) => ({ type, ...extra });
  const LESSON_SCHEMA = S('OBJECT', {
    properties: {
      title: S('STRING', { description: 'Titolo breve e chiaro dell\'argomento della lezione' }),
      suggestedSubject: S('STRING', { description: 'Nome della materia scelta tra quelle fornite' }),
      summary: S('STRING', { description: 'Riassunto discorsivo in markdown, ben strutturato con sottotitoli' }),
      cleanTranscript: S('STRING', {
        description: 'La spiegazione dell\'insegnante ripulita da rumori e chiacchiere, riorganizzata in paragrafi in markdown',
      }),
      filteredNoise: S('STRING', { description: 'Breve descrizione di cosa è stato scartato (chiacchiere, rumori, interruzioni…)' }),
      explanationPercent: S('INTEGER', { description: 'Stima 0-100 della percentuale di tempo dedicata alla spiegazione' }),
      mindmap: S('OBJECT', {
        properties: {
          center: S('STRING'),
          branches: S('ARRAY', {
            items: S('OBJECT', {
              properties: {
                title: S('STRING'),
                detail: S('STRING'),
                children: S('ARRAY', {
                  items: S('OBJECT', {
                    properties: {
                      title: S('STRING'),
                      detail: S('STRING'),
                      children: S('ARRAY', { items: S('OBJECT', { properties: { title: S('STRING') }, required: ['title'] }) }),
                    },
                    required: ['title'],
                  }),
                }),
              },
              required: ['title'],
            }),
          }),
        },
        required: ['center', 'branches'],
      }),
      keyPoints: S('ARRAY', { items: S('STRING') }),
      keyConcepts: S('ARRAY', {
        items: S('OBJECT', { properties: { term: S('STRING'), definition: S('STRING') }, required: ['term', 'definition'] }),
      }),
      flashcards: S('ARRAY', {
        items: S('OBJECT', { properties: { q: S('STRING'), a: S('STRING') }, required: ['q', 'a'] }),
      }),
      quiz: S('ARRAY', {
        items: S('OBJECT', {
          properties: {
            question: S('STRING'),
            options: S('ARRAY', { items: S('STRING') }),
            correct: S('INTEGER', { description: 'Indice (da 0) dell\'opzione corretta' }),
            explanation: S('STRING'),
          },
          required: ['question', 'options', 'correct'],
        }),
      }),
      examQuestions: S('ARRAY', { items: S('STRING') }),
      tasks: S('ARRAY', {
        items: S('OBJECT', {
          properties: {
            text: S('STRING'),
            due: S('STRING', { description: 'Data YYYY-MM-DD se deducibile, altrimenti stringa vuota' }),
            type: S('STRING', { description: 'compito | verifica | interrogazione | avviso' }),
          },
          required: ['text'],
        }),
      }),
    },
    required: ['title', 'summary', 'cleanTranscript', 'mindmap', 'keyPoints', 'keyConcepts', 'flashcards', 'quiz', 'examQuestions', 'tasks'],
  });

  const LESSON_SYSTEM = `Sei un assistente scolastico esperto che aiuta uno studente a studiare.
Ricevi la registrazione di una lezione in classe e/o una trascrizione automatica approssimativa (piena di errori), oppure appunti/foto.
In classe ci sono rumori: compagni che chiacchierano, battute, sedie, campanella, richiami disciplinari, interruzioni.

Il tuo lavoro:
1. Riconosci la voce principale dell'insegnante e i contenuti didattici veri (includi anche domande pertinenti degli studenti con le risposte del prof).
2. IGNORA chiacchiere tra compagni, battute, rumori, richiami disciplinari e discorsi irrilevanti. CONSERVA però compiti assegnati, date di verifiche/interrogazioni e avvisi importanti (vanno in "tasks").
3. Correggi gli errori della trascrizione automatica usando il contesto e la materia.
4. Crea materiale di studio chiaro, accurato e fedele a ciò che è stato spiegato. Se un concetto è stato accennato in modo incompleto puoi completarlo brevemente con conoscenze corrette, segnalandolo con "(integrazione)". Non inventare argomenti mai trattati.
5. Lo schema (mindmap) deve essere uno schema concettuale vero: nodo centrale = argomento, 3-7 rami principali, sotto-rami con parole chiave brevi (max 6-8 parole per nodo); usa "detail" per una spiegazione di una riga.
6. Scrivi in italiano. Se la materia è una lingua straniera mantieni esempi, regole e vocaboli nella lingua originale con traduzione.
7. Per le formule usa LaTeX tra $...$.
Se il contenuto didattico è quasi assente, dillo onestamente nel riassunto e produci comunque i campi richiesti (anche liste vuote).`;

  const DETAIL = {
    sintetico: 'Livello di dettaglio: SINTETICO (riassunto ~150 parole, 6 flashcard, 4 domande quiz, 3 domande interrogazione).',
    normale: 'Livello di dettaglio: NORMALE (riassunto ~300-400 parole, 10 flashcard, 6 domande quiz, 5 domande interrogazione).',
    dettagliato:
      'Livello di dettaglio: DETTAGLIATO (riassunto completo 600+ parole, 15+ flashcard, 10 domande quiz, 8 domande interrogazione, schema ricco).',
  };

  function parseJSON(text) {
    let t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try {
      return JSON.parse(t);
    } catch (e) {
      const a = t.indexOf('{');
      const b = t.lastIndexOf('}');
      if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
      throw new Error('La AI ha restituito una risposta non leggibile. Riprova.');
    }
  }

  async function analyzeLesson({ audioBlob, pdfBlob, pages, transcript, bookmarks, notesText, images, subjectName, signal, onStatus }) {
    const s = Store.settings();
    const subjects = Store.subjects().map((x) => x.name);
    const now = new Date();
    const parts = [];
    let audioUsed = false;

    if (audioBlob && audioBlob.size > 1000) {
      try {
        parts.push(await audioPart(audioBlob, onStatus));
        audioUsed = true;
      } catch (e) {
        console.warn('Audio non inviabile, uso solo la trascrizione', e);
        onStatus && onStatus('Audio troppo grande: uso la trascrizione…');
      }
    }
    let pdfUsed = false;
    if (pdfBlob) {
      parts.push(await pdfPart(pdfBlob, onStatus));
      pdfUsed = true;
    }
    for (const img of images || []) parts.push({ inlineData: { mimeType: img.mime, data: img.data } });

    const ctx = [
      `Data di oggi: ${U.todayStr(now)} (${now.toLocaleDateString('it-IT', { weekday: 'long' })}). Usala per convertire espressioni come "per giovedì" in date YYYY-MM-DD.`,
      subjectName
        ? `Materia indicata dallo studente: ${subjectName}.`
        : `Materia non indicata: scegli la più adatta tra: ${subjects.join(', ')}.`,
      DETAIL[s.detail] || DETAIL.normale,
      pdfUsed
        ? 'È allegato un DOCUMENTO PDF (libro, dispensa, slide o appunti): è la fonte principale e non ci sono rumori da filtrare. ' +
          'In "cleanTranscript" scrivi una spiegazione completa e ordinata del contenuto, come degli ottimi appunti; ' +
          'in "filteredNoise" indica brevemente cosa hai tralasciato (indici, esercizi, bibliografia…); ' +
          '"explanationPercent" = percentuale del documento che è contenuto di studio. Mantieni formule, date e definizioni esatte.' +
          (pages ? ` Concentrati SOLO sulle pagine ${pages}.` : '')
        : audioUsed
          ? 'È allegato l\'AUDIO della lezione: è la fonte principale. Ascoltalo tutto distinguendo la voce dell\'insegnante dal rumore di fondo.'
          : 'Audio non disponibile: lavora sul testo fornito.',
    ];
    if (bookmarks && bookmarks.length) {
      ctx.push(
        'Momenti segnati come IMPORTANTI dallo studente (dagli più rilievo):\n' +
          bookmarks.map((b) => `- [${U.fmtDuration(b.t)}] ${b.label || 'importante'}`).join('\n')
      );
    }
    if (transcript && transcript.trim()) {
      ctx.push('Trascrizione automatica in tempo reale (approssimativa, con errori e rumori):\n"""\n' + transcript.slice(0, 200000) + '\n"""');
    }
    if (notesText && notesText.trim()) ctx.push('Appunti/testo forniti dallo studente:\n"""\n' + notesText.slice(0, 200000) + '\n"""');
    if (images && images.length) ctx.push(`Sono allegate ${images.length} foto (lavagna/libro/appunti): leggile e integrale.`);

    if (!audioUsed && !pdfUsed && !(transcript || '').trim() && !(notesText || '').trim() && !(images || []).length) {
      throw new Error('Non c\'è niente da elaborare: nessun audio né testo registrato.');
    }

    parts.push({ text: ctx.join('\n\n') + '\n\nGenera ora il materiale di studio nel formato JSON richiesto.' });
    onStatus && onStatus(pdfUsed ? 'L\'AI sta leggendo il PDF…' : 'L\'AI sta ascoltando e capendo la lezione…');

    const run = async (p) =>
      generate({
        contents: [{ role: 'user', parts: p }],
        system: LESSON_SYSTEM,
        json: true,
        schema: LESSON_SCHEMA,
        temperature: 0.4,
        maxTokens: 32768,
        signal,
      });

    const formatError = (e) => e.status === 400 && /mime|audio|format|unsupported|invalid argument/i.test(e.raw || e.message);
    let out;
    try {
      out = await run(parts);
    } catch (e) {
      if (!audioUsed || !formatError(e)) throw e;
      // 1) WebM/MP4 solo-audio: riprova dichiarandoli come video (formati supportati ufficialmente, Gemini ne usa la traccia audio)
      const audio = parts[0].inlineData || parts[0].fileData;
      const asVideo = { 'audio/webm': 'video/webm', 'audio/mp4': 'video/mp4' }[audio.mimeType];
      let retried = false;
      if (asVideo) {
        try {
          onStatus && onStatus('Riprovo con un altro formato audio…');
          audio.mimeType = asVideo;
          out = await run(parts);
          retried = true;
        } catch (e2) {
          if (!formatError(e2)) throw e2;
        }
      }
      // 2) Ultima spiaggia: solo trascrizione/testo
      if (!retried) {
        if (!(transcript || notesText)) throw new Error('Google non accetta il formato audio di questo browser e non c\'è una trascrizione. Prova con Chrome o carica un file MP3.');
        onStatus && onStatus('Formato audio non supportato: uso la trascrizione…');
        out = await run(parts.filter((p) => !p.inlineData && !p.fileData));
        audioUsed = false;
      }
    }
    if (out.finish === 'MAX_TOKENS' && !out.text.trim().endsWith('}')) {
      throw new Error('La lezione è molto lunga e la risposta è stata troncata. Imposta il dettaglio su "sintetico" e riprova.');
    }
    const data = parseJSON(out.text);
    data.audioUsed = audioUsed;
    data.model = await model();
    return data;
  }

  /* ---------- Quiz generati dall'AI ---------- */
  const QUIZ_SCHEMA = S('OBJECT', {
    properties: {
      questions: S('ARRAY', {
        items: S('OBJECT', {
          properties: {
            type: S('STRING', { description: 'multipla | vf | aperta' }),
            question: S('STRING'),
            options: S('ARRAY', { items: S('STRING'), description: 'Vuoto per le domande aperte; ["Vero","Falso"] per vero/falso' }),
            correct: S('INTEGER', { description: 'Indice (da 0) della risposta corretta; 0 per le aperte' }),
            answer: S('STRING', { description: 'Risposta modello (soprattutto per le aperte)' }),
            explanation: S('STRING'),
            topic: S('STRING', { description: 'Argomento/lezione da cui viene la domanda' }),
          },
          required: ['type', 'question', 'explanation'],
        }),
      }),
    },
    required: ['questions'],
  });

  const FORMAT = {
    multipla: 'tutte a scelta multipla con 4 opzioni (una sola corretta, distrattori plausibili)',
    vf: 'tutte VERO/FALSO (options = ["Vero","Falso"]), con affermazioni non banali',
    aperta: 'tutte a RISPOSTA APERTA breve (2-5 righe), options vuoto, con risposta modello in "answer"',
    misto: 'miste: circa 60% scelta multipla (4 opzioni), 20% vero/falso, 20% risposta aperta',
  };
  const LEVEL = {
    facile: 'FACILE: definizioni e concetti base',
    media: 'MEDIA: comprensione e collegamenti, come in una verifica normale',
    difficile: 'DIFFICILE: ragionamento, applicazione, confronti e casi particolari, come una verifica impegnativa',
  };

  async function generateQuiz({ material, n = 10, difficulty = 'media', format = 'misto', signal }) {
    const prompt = [
      `Crea una verifica di ${n} domande basata SOLO sul materiale di studio qui sotto.`,
      `Difficoltà: ${LEVEL[difficulty] || LEVEL.media}.`,
      `Formato: ${FORMAT[format] || FORMAT.misto}.`,
      'Copri argomenti diversi in modo bilanciato, evita domande ripetute, scrivi una spiegazione utile per ogni risposta. Formule in LaTeX tra $...$.',
      '',
      'MATERIALE:',
      '<<<',
      material.slice(0, 300000),
      '>>>',
    ].join('\n');
    const out = await generate({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      system: 'Sei un insegnante italiano esperto che prepara verifiche scolastiche chiare, corrette e senza ambiguità.',
      json: true,
      schema: QUIZ_SCHEMA,
      temperature: 0.8,
      maxTokens: 16384,
      signal,
    });
    const qs = (parseJSON(out.text).questions || []).filter((q) => q && q.question);
    return qs.map((q) => {
      const type = q.type === 'aperta' || !(q.options || []).length ? 'open' : q.type === 'vf' ? 'vf' : 'mc';
      const options = type === 'open' ? [] : q.options;
      return {
        type,
        question: q.question,
        options,
        correct: type === 'open' ? 0 : Math.min(Math.max(0, q.correct | 0), options.length - 1),
        answer: q.answer || '',
        explanation: q.explanation || '',
        topic: q.topic || '',
      };
    });
  }

  async function gradeOpenAnswer({ question, modelAnswer, studentAnswer, signal }) {
    const prompt = [
      `Domanda: ${question}`,
      `Risposta di riferimento: ${modelAnswer || '(non fornita: usa le tue conoscenze)'}`,
      `Risposta dello studente: ${studentAnswer || '(nessuna risposta)'}`,
      '',
      'Valuta la risposta dello studente con un voto da 0 a 10 (scala scolastica italiana), in modo giusto ma incoraggiante. Indica cosa va bene e cosa manca.',
    ].join('\n');
    const out = await generate({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      system: 'Sei un professore italiano che corregge risposte brevi in modo equo e costruttivo.',
      json: true,
      schema: S('OBJECT', { properties: { score: S('NUMBER'), feedback: S('STRING') }, required: ['score', 'feedback'] }),
      temperature: 0.2,
      signal,
    });
    const r = parseJSON(out.text);
    return { score: Math.max(0, Math.min(10, Number(r.score) || 0)), feedback: r.feedback || '' };
  }

  /* ---------- Scrittura a mano → testo ---------- */
  async function transcribeHandwriting(images, { signal } = {}) {
    const out = await generate({
      contents: [
        {
          role: 'user',
          parts: [
            ...images.map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } })),
            {
              text: 'Trascrivi fedelmente questi appunti scritti a mano. Mantieni la struttura (titoli, elenchi, frecce come "→"), scrivi le formule in LaTeX tra $...$ e descrivi brevemente tra [parentesi quadre] eventuali disegni o schemi. Non aggiungere commenti: restituisci solo il testo in markdown.',
            },
          ],
        },
      ],
      temperature: 0.1,
      signal,
    });
    return out.text.trim();
  }

  async function testKey(key) {
    const models = await listModels(key);
    if (!models.length) throw new Error('La key funziona ma non ha modelli Gemini disponibili.');
    return models;
  }

  return {
    listModels, model, resetModelCache, generate, stream, analyzeLesson, testKey, pickBest,
    generateQuiz, gradeOpenAnswer, transcribeHandwriting,
  };
})();
