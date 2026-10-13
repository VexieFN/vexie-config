'use strict';

/* Persistenza locale: IndexedDB per lezioni/audio/chat, localStorage per impostazioni, materie e agenda.
   Tutti i dati restano sul dispositivo dell'utente. */
const Store = (() => {
  const DB_NAME = 'scuola-ai';
  const DB_VERSION = 2;
  const LS = 'scuolaai.';
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('lessons')) d.createObjectStore('lessons', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio');
          if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats');
          // v2: quaderno (appunti a mano/testo) e file allegati (PDF)
          if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(storeName, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transazione annullata'));
    });
  }

  /* ---------- Lezioni ---------- */
  const lessons = {
    async all() {
      const list = (await run('lessons', 'readonly', (s) => s.getAll())) || [];
      return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    },
    get: (id) => run('lessons', 'readonly', (s) => s.get(id)),
    async put(lesson) {
      lesson.updatedAt = new Date().toISOString();
      await run('lessons', 'readwrite', (s) => s.put(lesson));
      return lesson;
    },
    async del(id) {
      await run('lessons', 'readwrite', (s) => s.delete(id));
      await run('audio', 'readwrite', (s) => s.delete(id));
      await run('chats', 'readwrite', (s) => s.delete('lesson:' + id));
      await run('files', 'readwrite', (s) => s.delete(id));
    },
  };

  const files = {
    get: (id) => run('files', 'readonly', (s) => s.get(id)),
    put: (id, blob) => run('files', 'readwrite', (s) => s.put(blob, id)),
    del: (id) => run('files', 'readwrite', (s) => s.delete(id)),
  };

  /* ---------- Quaderno ---------- */
  const notes = {
    async all() {
      const list = (await run('notes', 'readonly', (s) => s.getAll())) || [];
      return list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    },
    get: (id) => run('notes', 'readonly', (s) => s.get(id)),
    async put(note) {
      note.updatedAt = new Date().toISOString();
      await run('notes', 'readwrite', (s) => s.put(note));
      return note;
    },
    del: (id) => run('notes', 'readwrite', (s) => s.delete(id)),
  };

  const audio = {
    get: (id) => run('audio', 'readonly', (s) => s.get(id)),
    put: (id, blob) => run('audio', 'readwrite', (s) => s.put(blob, id)),
    del: (id) => run('audio', 'readwrite', (s) => s.delete(id)),
  };

  const chats = {
    async get(key) {
      return (await run('chats', 'readonly', (s) => s.get(key))) || [];
    },
    put: (key, msgs) => run('chats', 'readwrite', (s) => s.put(msgs.slice(-80), key)),
    del: (key) => run('chats', 'readwrite', (s) => s.delete(key)),
  };

  /* ---------- localStorage ---------- */
  function lsGet(key, fallback) {
    try {
      const v = localStorage.getItem(LS + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function lsSet(key, value) {
    try {
      localStorage.setItem(LS + key, JSON.stringify(value));
    } catch (e) {
      U.toast('Memoria del browser piena: impossibile salvare', 'error');
    }
  }

  const DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'auto',
    name: '',
    lang: 'it-IT',
    liveTranscript: true,
    voiceFilter: true,
    autoProcess: true,
    detail: 'normale',
    theme: 'auto',
    consentShown: false,
  };

  function settings() {
    return { ...DEFAULT_SETTINGS, ...lsGet('settings', {}) };
  }
  function saveSettings(patch) {
    const s = { ...settings(), ...patch };
    lsSet('settings', s);
    return s;
  }

  const DEFAULT_SUBJECTS = [
    ['Italiano', '📖', '#e5484d'],
    ['Matematica', '📐', '#3e63dd'],
    ['Storia', '🏛️', '#ad7f58'],
    ['Geografia', '🌍', '#30a46c'],
    ['Inglese', '🇬🇧', '#8e4ec6'],
    ['Scienze', '🔬', '#12a594'],
    ['Fisica', '⚛️', '#0090ff'],
    ['Filosofia', '🤔', '#d6409f'],
    ['Arte', '🎨', '#f76b15'],
    ['Informatica', '💻', '#5b5bd6'],
  ].map(([name, emoji, color]) => ({ id: U.slug(name), name, emoji, color }));

  function subjects() {
    return lsGet('subjects', null) || DEFAULT_SUBJECTS;
  }
  function saveSubjects(list) {
    lsSet('subjects', list);
  }
  function subject(id) {
    return subjects().find((s) => s.id === id) || { id: '', name: 'Senza materia', emoji: '📝', color: '#8b8d98' };
  }

  /* Liste semplici in localStorage */
  const list = (key) => ({
    all: () => lsGet(key, []),
    save: (v) => lsSet(key, v),
  });
  const grades = list('grades'); // voti
  const quizHistory = list('quizHistory'); // risultati dei quiz
  const mistakes = list('mistakes'); // domande sbagliate da ripassare
  const timetable = {
    get: () =>
      lsGet('timetable', null) || {
        days: 6,
        slots: [
          ['08:00', '09:00'],
          ['09:00', '10:00'],
          ['10:00', '11:00'],
          ['11:00', '12:00'],
          ['12:00', '13:00'],
          ['13:00', '14:00'],
        ],
        cells: {},
      },
    save: (v) => lsSet('timetable', v),
  };

  function tasks() {
    return lsGet('tasks', []);
  }
  function saveTasks(list) {
    lsSet('tasks', list);
  }

  /* Bozza della registrazione in corso (protezione da crash/chiusura accidentale) */
  const draft = {
    meta: () => lsGet('draft', null),
    async save(meta, blob) {
      lsSet('draft', meta);
      if (blob) await audio.put('__draft__', blob);
    },
    blob: () => audio.get('__draft__'),
    async clear() {
      localStorage.removeItem(LS + 'draft');
      await audio.del('__draft__');
    },
  };

  /* ---------- Backup ---------- */
  async function exportAll(includeAudio) {
    const all = await lessons.all();
    const out = {
      app: 'scuola-ai',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...settings(), apiKey: '' },
      subjects: subjects(),
      tasks: tasks(),
      lessons: all,
      notes: await notes.all(),
      grades: grades.all(),
      quizHistory: quizHistory.all(),
      mistakes: mistakes.all(),
      timetable: timetable.get(),
      audio: {},
      files: {},
    };
    if (includeAudio) {
      for (const l of all) {
        const b = await audio.get(l.id);
        if (b) out.audio[l.id] = { mime: b.type, data: await U.blobToBase64(b) };
        const f = await files.get(l.id);
        if (f) out.files[l.id] = { mime: f.type, data: await U.blobToBase64(f) };
      }
    }
    return out;
  }

  async function importAll(data) {
    if (!data || data.app !== 'scuola-ai') throw new Error('File di backup non valido');
    if (Array.isArray(data.subjects)) saveSubjects(data.subjects);
    if (Array.isArray(data.tasks)) {
      const ids = new Set(tasks().map((t) => t.id));
      saveTasks([...tasks(), ...data.tasks.filter((t) => !ids.has(t.id))]);
    }
    const merge = (store, key = 'id') => {
      if (!Array.isArray(data[store])) return;
      const ids = new Set(Store[store].all().map((x) => x[key]));
      Store[store].save([...Store[store].all(), ...data[store].filter((x) => !ids.has(x[key]))]);
    };
    merge('grades');
    merge('quizHistory');
    merge('mistakes', 'question');
    if (data.timetable && data.timetable.slots) timetable.save(data.timetable);
    for (const nt of data.notes || []) await run('notes', 'readwrite', (s) => s.put(nt));
    let n = 0;
    for (const l of data.lessons || []) {
      await run('lessons', 'readwrite', (s) => s.put(l));
      const a = data.audio && data.audio[l.id];
      if (a) await audio.put(l.id, U.base64ToBlob(a.data, a.mime));
      const f = data.files && data.files[l.id];
      if (f) await files.put(l.id, U.base64ToBlob(f.data, f.mime));
      n++;
    }
    return n;
  }

  async function wipe() {
    for (const name of ['lessons', 'audio', 'chats', 'notes', 'files']) await run(name, 'readwrite', (s) => s.clear());
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LS))
      .forEach((k) => localStorage.removeItem(k));
  }

  return {
    lessons, audio, chats, draft, files, notes, grades, quizHistory, mistakes, timetable,
    settings, saveSettings, subjects, saveSubjects, subject, tasks, saveTasks,
    exportAll, importAll, wipe,
  };
})();
