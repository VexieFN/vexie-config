# 🎓 Scuola AI

**Ascolta la lezione, separa la spiegazione del prof dal casino della classe e crea in automatico schemi, riassunti, flashcard e quiz.** Funziona con l'AI di Google Gemini e la tua API key gratuita.

È una web app installabile (PWA): va su telefono (Android/iPhone) e su PC, senza app store e senza server. Tutti i dati restano sul tuo dispositivo.

---

## ✨ Cosa fa

| | Funzione |
|---|---|
| 🎙️ | **Ascolta la lezione** dal microfono, con timer, pausa e lo schermo che resta acceso |
| 🧹 | **Filtro anti-casino a 3 livelli**: (1) soppressione di rumore ed eco del browser, (2) filtri audio sulla banda della voce (tagliano banchi, sedie, ronzii, fruscii), (3) **Gemini ascolta l'audio** e tiene solo la spiegazione, scartando chiacchiere, battute e richiami |
| 📊 | Indicatore in tempo reale **🗣️ Spiegazione / 🔊 Rumore / 🤫 Silenzio** e percentuali |
| 📝 | **Trascrizione dal vivo** mentre il prof parla (Chrome/Edge/Android) |
| ⭐ | Tasto **"Importante!"** e appunti veloci: l'AI dà più peso a quei momenti |
| 🗺️ | **Schema (mappa concettuale)** interattivo: zoom, trascinamento, rami che si aprono e chiudono, export PNG/SVG, vista a elenco |
| 📄 | Riassunto, spiegazione ripulita, concetti chiave e punti da ricordare |
| 🧠 | **Flashcard con ripetizione dilazionata** (1, 3, 7, 14, 30 giorni) e **Ripasso del giorno** da tutte le lezioni |
| ❓ | **Quiz** a risposta multipla con spiegazioni e voto indicativo |
| 🎓 | **Simulazione di interrogazione**: Prof AI ti fa le domande e ti dà un voto |
| 📚 | **Materie** personalizzabili (nome, emoji, colore), materia riconosciuta in automatico, **ricerca** in tutte le lezioni |
| 💬 | **Prof AI**: chat con Gemini, anche su una lezione o su **tutta una materia**; foto di esercizi e lavagna 📷, dettatura 🎤, formule matematiche, risposte salvabili negli appunti |
| 📅 | **Agenda**: compiti e verifiche annunciati in classe finiscono **in agenda da soli**; export in calendario (.ics) |
| 📁📷📝 | Schemi anche da **file audio**, **foto** (lavagna, libro, appunti) o **testo** |
| 🔊 | Lettura ad alta voce di riassunti e risposte |
| 💾 | Salvataggio automatico ogni 30 s (se il telefono si spegne recuperi la registrazione), backup e ripristino, tema chiaro/scuro, stampa/PDF |

---

## 🚀 Come pubblicarla (gratis, 2 minuti)

Il microfono funziona solo su un sito **HTTPS**, quindi conviene usare **GitHub Pages**:

1. Sul repository GitHub vai in **Settings → Pages**
2. In *Build and deployment* scegli **Deploy from a branch**
3. Scegli il branch (`main` dopo il merge, oppure direttamente questo branch) e la cartella **`/docs`**, poi **Save**
4. Dopo circa un minuto l'app è online su `https://<tuo-utente>.github.io/<nome-repo>/`

### 📲 Installala sul telefono
- **Android (Chrome)**: apri il link → menu ⋮ → **Installa app** (oppure il pulsante in Impostazioni)
- **iPhone (Safari)**: apri il link → Condividi → **Aggiungi alla schermata Home**

### 💻 Provarla sul PC senza pubblicarla
Dalla cartella `docs`: `npx serve .` (oppure `python3 -m http.server`) e apri `http://localhost:3000` (o `:8000`). Su `localhost` il microfono funziona anche senza HTTPS.

---

## 🔑 La API key di Google Gemini (gratis)

1. Vai su **https://aistudio.google.com/apikey** e accedi con Google
2. Premi **Create API key** e copiala
3. Nell'app: ⚙️ **Impostazioni → API key** → incollala → **Salva e verifica**

Con il modello **Automatico** l'app sceglie da sola il miglior modello "Flash" disponibile per la tua key (veloce ed economico). Il piano gratuito ha un limite di richieste al minuto: se compare "limite raggiunto", aspetta un minuto.

> La key resta solo nel tuo browser e viene inviata soltanto a Google. Non metterla nel codice e non condividerla.

---

## 🎯 Consigli per i risultati migliori

- Metti il telefono **sul banco, con il microfono verso la cattedra**, non in tasca o nello zaino
- Tieni lo schermo acceso: l'app lo fa da sola; se lo spegni alcuni telefoni mettono in pausa il microfono
- Premi ⭐ quando il prof dice "questo è importante" o "questo esce in verifica"
- Se su Android la registrazione ha problemi, disattiva **Trascrizione dal vivo** nelle impostazioni: l'AI ascolterà comunque tutto l'audio
- Una lezione di un'ora pesa circa 11 MB e l'AI la elabora in 1-2 minuti
- Per lezioni molto lunghe imposta il dettaglio su **Sintetico**

## 🤝 Privacy e rispetto

- **Chiedi sempre al professore** il permesso di registrare: in molte scuole serve, ed è comunque corretto
- Audio e lezioni sono salvati **solo sul tuo dispositivo** (IndexedDB). Vengono inviati a Google Gemini solo quando chiedi di creare gli schemi o fai una domanda a Prof AI
- Dalle impostazioni puoi esportare un backup o cancellare tutto

---

## 🛠️ Struttura tecnica

HTML, CSS e JavaScript puro, senza build e senza dipendenze (solo KaTeX da CDN per le formule, facoltativo).

```
docs/
├── index.html            pagina dell'app
├── manifest.webmanifest  installazione PWA
├── sw.js                 service worker (offline)
├── css/style.css         stile (chiaro/scuro, mobile-first)
├── icons/                icone
└── js/
    ├── util.js           utility, markdown sicuro, modali, toast
    ├── store.js          salvataggio locale (IndexedDB + localStorage), backup
    ├── recorder.js       microfono, filtri voce, rilevamento rumore, trascrizione live
    ├── gemini.js         client della Gemini API (analisi della lezione, chat in streaming, upload file)
    ├── mindmap.js        mappa concettuale SVG interattiva + export
    ├── components.js     flashcard, quiz, sintesi vocale
    └── app.js            viste e logica dell'app
```

**Browser consigliati:** Chrome o Edge (anche su Android) per tutte le funzioni. Safari va bene ma senza trascrizione dal vivo su alcune versioni; l'AI ascolta comunque l'audio registrato.
