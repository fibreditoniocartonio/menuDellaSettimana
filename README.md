# ??? Gestore Menu Famiglia

Un'applicazione web semplice e leggera realizzata in Node.js per gestire le ricette di casa, generare menu settimanali equilibrati e compilare automaticamente la lista della spesa.

L'obiettivo del progetto è avere uno strumento personale, privo di dipendenze complesse lato client, facile da installare e gestire su un piccolo server casalingo o sul proprio PC.

## ??? Requisiti di Sistema

Per eseguire il server hai bisogno solo di:
*   **Node.js**: (Versione 14 o superiore raccomandata).
*   **NPM**: Solitamente installato insieme a Node.js.

*Nota: Non serve installare database esterni (come MySQL o MongoDB) perché l'app utilizza **SQLite**, che salva tutto in un semplice file locale.*

## ?? Installazione e Avvio

1.  **Scarica il progetto**
    Inserisci i file `server.js`, `package.json` e la cartella `public` (con `index.html`, `style.css`, `script.js`) in una directory.

2.  **Installa le dipendenze**
    Apri il terminale nella cartella del progetto ed esegui:
    ```bash
    npm install
    ```
    *Questo installerà automaticamente: `express`, `sqlite3`, `cors`, `body-parser`.*

3.  **Avvia il Server**
    Sempre da terminale:
    ```bash
    node server.js
    ```
    Dovresti vedere il messaggio: `Server attivo su http://localhost:3000`.

4.  **Primo Accesso**
    *   Apri il browser e vai su `http://localhost:3000`.
    *   Inserisci il codice di accesso predefinito: **0902**.

## ?? Struttura del Progetto

*   **server.js**: Il cuore dell'applicazione. Gestisce le API, la logica del menu e il database SQLite.
*   **recipes.db**: (Generato automaticamente all'avvio) Il file che contiene tutte le tue ricette e il menu salvato.
*   **public/**:
    *   `index.html`: L'interfaccia utente.
    *   `style.css`: Lo stile grafico.
    *   `script.js`: La logica lato client che comunica con il server.

## ?? Note sull'uso

*   **Backup**: Per fare un backup dei dati, basta copiare il file `recipes.db` oppure usare la funzione "Esporta CSV" dall'interfaccia.
*   **Quantità**: Puoi inserire numeri (es. `100` per 100g) o testo come `qb` o `quanto basta`. Il sistema sommerà i numeri e lascerà il testo invariato nella lista della spesa.