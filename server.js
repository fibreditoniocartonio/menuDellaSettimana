const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// CONFIGURAZIONE
const SECRET_CODE = "0902"; 
const DB_FILE = "recipes.db";

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // Aumentato limite per import grossi
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_FILE);

// INIZIALIZZAZIONE DB
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        servings INTEGER,
        ingredients TEXT 
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS menu_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT
    )`);
});

// MIDDLEWARE AUTH
const checkAuth = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === `Bearer ${SECRET_CODE}`) {
        next();
    } else {
        res.status(401).json({ error: "Non autorizzato" });
    }
};

// UTILS
const toTitleCase = (str) => str.replace(/\b\w/g, l => l.toUpperCase());
const updateShoppingList = (list, name, qtyRaw, ratio) => {
    const key = name.trim().toLowerCase();
    const qtyNum = parseFloat(qtyRaw.toString().replace(',', '.'));
    
    if (!list[key]) list[key] = { total: 0, isQb: false };

    if (isNaN(qtyNum)) {
        list[key].isQb = true;
    } else {
        list[key].total += (qtyNum * ratio);
    }
};

// --- ROTTE PUBLIC ---
app.post('/api/login', (req, res) => {
    const { code } = req.body;
    if (code === SECRET_CODE) {
        res.json({ token: SECRET_CODE, message: "Login OK" });
    } else {
        res.status(401).json({ error: "Codice errato" });
    }
});

// --- ROTTE PROTETTE ---

// GET RICETTE
app.get('/api/recipes', checkAuth, (req, res) => {
    db.all("SELECT * FROM recipes ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const recipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
        res.json(recipes);
    });
});

// CREA RICETTA
app.post('/api/recipes', checkAuth, (req, res) => {
    const { name, type, servings, ingredients } = req.body;
    const ingJson = JSON.stringify(ingredients);
    
    db.run(`INSERT INTO recipes (name, type, servings, ingredients) VALUES (?, ?, ?, ?)`, 
        [name, type, servings, ingJson], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: "Ricetta aggiunta" });
        }
    );
});

// AGGIORNA RICETTA
app.put('/api/recipes/:id', checkAuth, (req, res) => {
    const { name, type, servings, ingredients } = req.body;
    const ingJson = JSON.stringify(ingredients);
    
    db.run(`UPDATE recipes SET name = ?, type = ?, servings = ?, ingredients = ? WHERE id = ?`,
        [name, type, servings, ingJson, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Ricetta aggiornata" });
        }
    );
});

// ELIMINA RICETTA
app.delete('/api/recipes/:id', checkAuth, (req, res) => {
    db.run(`DELETE FROM recipes WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Ricetta eliminata" });
    });
});

// GENERA MENU
app.post('/api/generate-menu', checkAuth, (req, res) => {
    const { people } = req.body;
    
    db.all("SELECT * FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length < 2) return res.status(400).json({ error: "Inserisci almeno un po' di ricette prima!" });
        
        const recipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
        const primi = recipes.filter(r => r.type === 'primo');
        const secondi = recipes.filter(r => r.type === 'secondo');
        
        const weekMenu = [];
        const shoppingListRaw = {}; 
        const getRandom = (arr) => arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null;

        for (let i = 0; i < 7; i++) {
            const dayMenu = { day: i + 1, lunch: null, dinner: null };
            // Logica alternanza semplice
            if (i % 2 === 0) {
                dayMenu.lunch = getRandom(primi);
                dayMenu.dinner = getRandom(secondi);
            } else {
                dayMenu.lunch = getRandom(secondi);
                dayMenu.dinner = getRandom(primi);
            }
            weekMenu.push(dayMenu);

            [dayMenu.lunch, dayMenu.dinner].forEach(meal => {
                if (meal) {
                    const ratio = people / meal.servings;
                    meal.ingredients.forEach(ing => {
                        updateShoppingList(shoppingListRaw, ing.name, ing.quantity, ratio);
                    });
                }
            });
        }

        const shoppingList = {};
        Object.keys(shoppingListRaw).sort().forEach(k => {
            const item = shoppingListRaw[k];
            shoppingList[toTitleCase(k)] = item.isQb ? "q.b." : Math.ceil(item.total);
        });

        const stateData = { menu: weekMenu, shoppingList, dessert: null, people };
        
        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(stateData)], (e) => {
            if (e) console.error(e);
            res.json(stateData);
        });
    });
});

// LEGGI ULTIMO MENU
app.get('/api/last-menu', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.json(null);
        res.json(JSON.parse(row.data));
    });
});

// GENERA DOLCE
app.post('/api/generate-dessert', checkAuth, (req, res) => {
    const { people } = req.body;
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Genera prima un menu settimanale" });
        
        let currentState = JSON.parse(rowState.data);
        
        db.all("SELECT * FROM recipes WHERE type = 'dolce'", [], (err, rows) => {
            if (rows.length === 0) return res.json({ message: "Nessun dolce disponibile", currentState });
            
            const randomDessert = rows[Math.floor(Math.random() * rows.length)];
            randomDessert.ingredients = JSON.parse(randomDessert.ingredients);
            
            currentState.dessert = randomDessert;
            
            const ratio = people / randomDessert.servings;
            randomDessert.ingredients.forEach(ing => {
                const key = toTitleCase(ing.name.trim().toLowerCase());
                const qtyNum = parseFloat(ing.quantity.toString().replace(',', '.'));
                const isNewQb = isNaN(qtyNum);
                
                let currentVal = currentState.shoppingList[key];
                
                if (currentVal === undefined) {
                    currentState.shoppingList[key] = isNewQb ? "q.b." : Math.ceil(qtyNum * ratio);
                } else {
                    if (currentVal === "q.b." || isNewQb) {
                        currentState.shoppingList[key] = "q.b.";
                    } else {
                        currentState.shoppingList[key] = parseInt(currentVal) + Math.ceil(qtyNum * ratio);
                    }
                }
            });

            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
                res.json(currentState);
            });
        });
    });
});

// --- NUOVO EXPORT JSON ---
app.get('/api/export-json', checkAuth, (req, res) => {
    db.all("SELECT name, type, servings, ingredients FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "Errore export" });
        
        // rows contiene già ingredients come stringa JSON. Li parsiamo per avere un JSON pulito.
        const cleanData = rows.map(r => ({
            ...r,
            ingredients: JSON.parse(r.ingredients)
        }));

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=ricette_backup.json');
        res.json(cleanData);
    });
});

// --- NUOVO IMPORT JSON ---
app.post('/api/import-json', checkAuth, (req, res) => {
    const recipes = req.body; // body-parser gestisce il JSON array

    if (!Array.isArray(recipes)) {
        return res.status(400).json({ error: "Il file deve contenere una lista di ricette" });
    }

    const stmt = db.prepare(`INSERT INTO recipes (name, type, servings, ingredients) VALUES (?, ?, ?, ?)`);
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        recipes.forEach(r => {
            // Controllo minimo validità
            if(r.name && r.type) {
                // Se ingredients è già un oggetto/array, lo stringifichiamo per il DB
                const ingString = typeof r.ingredients === 'object' ? JSON.stringify(r.ingredients) : r.ingredients;
                stmt.run(r.name, r.type, r.servings || 2, ingString);
            }
        });
        db.run("COMMIT", (err) => {
            stmt.finalize();
            if (err) return res.status(500).json({ error: "Errore durante importazione" });
            res.json({ message: `Importate ${recipes.length} ricette con successo` });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Chef App attiva su http://localhost:${PORT}`);
});