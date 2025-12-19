# 👨‍🍳 Gestore Menu Famiglia

Un'applicazione web semplice e leggera realizzata in **Node.js** per gestire le ricette di casa, generare menu settimanali equilibrati e compilare automaticamente la lista della spesa sincronizzata.

L'obiettivo del progetto è avere uno strumento personale, privo di framework complessi lato client, facile da installare e gestire su un piccolo server casalingo o su hosting gratuiti (es. Alwaysdata).

## ✨ Funzionalità

*   **Gestione Ricette**: Crea, modifica ed elimina ricette con ingredienti e porzioni.
*   **Generatore Menu**: Algoritmo che bilancia Primi e Secondi tra pranzo e cena per 7 giorni.
*   **Lista della Spesa Smart**:
    *   Somma automatica degli ingredienti (es. 200g + 100g = 300g).
    *   Supporto per unità "q.b." (quanto basta).
    *   **Sync in Tempo Reale**: Le spunte sulla lista sono salvate sul server e visibili da tutti i dispositivi connessi.
    *   **Safety Uncheck**: Se aumenti le persone a cena, la spunta sull'ingrediente si toglie automaticamente per obbligarti a ricontrollare se ne hai abbastanza.
*   **Backup Dati**: Importazione ed Esportazione completa in formato JSON.

## 🛠️ Requisiti di Sistema

Per eseguire il server hai bisogno solo di:
*   **Node.js**: (Versione 14 o superiore raccomandata).
*   **NPM**: Solitamente installato insieme a Node.js.

*Nota: Non serve installare database esterni (come MySQL o MongoDB) perché l'app utilizza **SQLite**, che salva tutto in un semplice file locale.*

## 🚀 Installazione e Avvio

### 1. Scarica il progetto
Inserisci i file `server.js`, `package.json` e la cartella `public` (con `index.html`, `style.css`, `script.js`) in una directory.

### 2. Installa le dipendenze
Apri il terminale nella cartella del progetto ed esegui:
```bash
npm install express sqlite3 cors body-parser
```

### 3. Avvia il Server

**In Locale:**
```bash
node server.js
```
Il server partirà su `http://localhost:3000`.

**Su Hosting (es. Alwaysdata):**
Il server è configurato per leggere automaticamente le variabili d'ambiente `PORT` e `IP` (o `HOST`) fornite dal provider.
```bash
node server.js
```

### 4. Primo Accesso
1.  Apri il browser.
2.  Inserisci il codice di accesso predefinito (modificabile in `server.js`): **0902**.

## 📂 Struttura del Progetto

*   **`server.js`**: Il cuore dell'applicazione. Gestisce le API, la logica del menu, il calcolo della spesa e il database SQLite.
*   **`recipes.db`**: (Generato automaticamente al primo avvio) Il file SQLite che contiene tutte le tue ricette, il menu corrente e lo stato della spesa.
*   **`package.json`**: Elenco delle dipendenze.
*   **`public/`**:
    *   `index.html`: L'interfaccia utente (Single Page Application).
    *   `style.css`: Foglio di stile responsive (Mobile first).
    *   `script.js`: Logica frontend per comunicare con le API.

## 📝 Note sull'uso

*   **Backup**: Per fare un backup, usa il tasto **"Backup / Ripristino"** nella dashboard e scarica il file `.json`. Non serve copiare manualmente il file `.db`.
*   **Inserimento Ingredienti**:
    *   **Numeri**: Inserisci solo numeri (es. `100`) se vuoi che vengano sommati matematicamente.
    *   **Testo**: Puoi inserire `qb`, `mezzo bicchiere`, `un pizzico`. Il sistema li raggrupperà nella lista senza fare calcoli matematici.
