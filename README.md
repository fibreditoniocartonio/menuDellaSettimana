# 👨‍🍳 Gestore Menu Famiglia (Versione PHP)

Un'applicazione web estremamente leggera e portatile realizzata in **PHP** per gestire le ricette di casa, generare menu settimanali equilibrati e compilare automaticamente la lista della spesa.

L'obiettivo di questa versione è la massima **portabilità**: può essere installata su qualsiasi hosting economico, NAS o server casalingo che supporti PHP, senza necessità di configurare complessi ambienti di runtime.

## ✨ Funzionalità Avanzate

*   **Gestione Ricette Completa**: Crea ricette dettagliate con ingredienti, procedimento, difficoltà e numero di porzioni.
*   **Generatore Menu Intelligente**:
    *   Algoritmo che bilancia Primi (pranzo) e Secondi (cena) su 7 giorni.
    *   **Pasti Composti**: Supporta l'abbinamento automatico (es. Pasta + Sugo o Secondo + Contorno).
    *   **Weighted Random**: Le ricette più semplici compaiono più spesso di quelle elaborate.
*   **Temi Dinamici e Stagionali**: L'interfaccia cambia aspetto e sfondi in base al periodo dell'anno (Natale, Halloween, Pasqua, Estate, ecc.) o secondo la tua scelta.
*   **Lista della Spesa Smart**:
    *   **Somma Automatica**: Converte e somma le quantità numeriche tra diverse ricette.
    *   **Dettaglio Utilizzi**: Clicca su un ingrediente per vedere esattamente in quali ricette del menu è richiesto e in che quantità.
    *   **Sync in Tempo Reale**: Lo stato della spesa è salvato sul server; puoi spuntare gli articoli al supermercato dal telefono e vederli aggiornati a casa.
    *   **Articoli Extra**: Aggiungi manualmente prodotti fuori menu (latte, pane, ecc.).
*   **Gestione Dati Professionale**:
    *   **Import Avanzato**: Sistema di risoluzione conflitti con *fuzzy matching* (rileva se una ricetta che stai importando esiste già con un nome simile).
    *   **Export Selettivo**: Scegli quali ricette esportare nel backup JSON.

## 🛠️ Requisiti di Sistema

*   **Web Server**: Apache o Nginx.
*   **PHP**: Versione 7.4 o superiore.
*   **Estensione PDO SQLite**: Solitamente abilitata di default in quasi tutti gli ambienti PHP.

*L'app utilizza **SQLite**, quindi non serve configurare MySQL o altri database pesanti. Tutto viene salvato in un unico file nella cartella `data/`.*

## 🚀 Installazione e Avvio

### 1. Carica i file
Copia tutti i file del progetto nella cartella pubblica del tuo server (es. `public_html`, `www`, o `htdocs`).

### 2. Permessi della cartella dati
Assicurati che la cartella `data/` abbia i permessi di scrittura, affinché PHP possa creare e aggiornare il database:
```bash
chmod 777 data
```

### 3. Configurazione Server (Apache)
Il file `.htaccess` incluso gestisce la sicurezza e il routing. Assicurati che il modulo `mod_rewrite` sia attivo sul tuo server Apache. Se usi Nginx, dovrai configurare manualmente il pass-through per `api.php`.

### 4. Primo Accesso
1.  Apri il browser all'indirizzo del tuo server.
2.  Inserisci il codice di accesso predefinito: **1234** (puoi cambiarlo all'inizio del file `api.php`).

## 📂 Struttura del Progetto

*   **`api.php`**: Il cuore dell'applicazione. Gestisce tutte le richieste API, la logica del menu, il calcolo della spesa e il database.
*   **`index.html`**: L'interfaccia utente (Single Page Application).
*   **`script.js`**: Logica frontend e comunicazione con le API PHP.
*   **`style.css`**: Design responsive con supporto ai temi stagionali.
*   **`data/`**: Cartella che ospita `recipes.db` (il database SQLite).
*   **`bg/`**: Cartella contenente le immagini di sfondo stagionali.

## 📝 Note sull'uso

*   **Sicurezza**: Il file `.htaccess` impedisce l'accesso diretto al file del database tramite browser.
*   **Inserimento Ingredienti**:
    *   Usa i numeri per quantità sommabili (es. `200`).
    *   Usa testo per unità non quantificabili (es. `qb`, `un pizzico`).
*   **Importazione**: Se importi un backup, il sistema ti chiederà se vuoi sovrascrivere, saltare o tenere entrambe le versioni in caso di ricette con nomi simili.