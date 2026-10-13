'use strict';

/* Persistenza locale: IndexedDB per lezioni/audio/chat, localStorage per impostazioni, materie e agenda.
   Tutti i dati restano sul dispositivo dell'utente. */
const Store = (() => {
  const DB_NAME = 'scuola-ai';
  const DB_VERSION = 1;
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
    },
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
      audio: {},
    };
    if (includeAudio) {
      for (const l of all) {
        const b = await audio.get(l.id);
        if (b) out.audio[l.id] = { mime: b.type, data: await U.blobToBase64(b) };
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
    let n = 0;
    for (const l of data.lessons || []) {
      await run('lessons', 'readwrite', (s) => s.put(l));
      const a = data.audio && data.audio[l.id];
      if (a) await audio.put(l.id, U.base64ToBlob(a.data, a.mime));
      n++;
    }
    return n;
  }

  async function wipe() {
    for (const name of ['lessons', 'audio', 'chats']) await run(name, 'readwrite', (s) => s.clear());
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LS))
      .forEach((k) => localStorage.removeItem(k));
  }

  return {
    lessons, audio, chats, draft,
    settings, saveSettings, subjects, saveSubjects, subject, tasks, saveTasks,
    exportAll, importAll, wipe,
  };
})();
