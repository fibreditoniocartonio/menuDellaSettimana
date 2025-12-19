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
app.use(bodyParser.json({ limit: '10mb' })); 
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

// Helper: Ricalcola lista della spesa dall'intero menu attuale
function calculateShoppingList(menu, dessert, people) {
    const listRaw = {};
    const itemsToProcess = [];

    // Raccogli tutti i pasti
    menu.forEach(day => {
        if(day.lunch) itemsToProcess.push(day.lunch);
        if(day.dinner) itemsToProcess.push(day.dinner);
    });
    if(dessert) itemsToProcess.push(dessert);

    // Calcola ingredienti
    itemsToProcess.forEach(meal => {
        const ratio = people / meal.servings;
        meal.ingredients.forEach(ing => {
            updateShoppingList(listRaw, ing.name, ing.quantity, ratio);
        });
    });

    // Formatta output
    const finalObj = {};
    Object.keys(listRaw).sort().forEach(k => {
        const item = listRaw[k];
        finalObj[toTitleCase(k)] = item.isQb ? "q.b." : Math.ceil(item.total);
    });
    return finalObj;
}

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

// GENERA MENU (Nuova Logica)
app.post('/api/generate-menu', checkAuth, (req, res) => {
    const { people } = req.body;
    
    db.all("SELECT * FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length < 2) return res.status(400).json({ error: "Inserisci almeno un po' di ricette prima!" });
        
        const allRecipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
        const primi = allRecipes.filter(r => r.type === 'primo');
        const secondi = allRecipes.filter(r => r.type === 'secondo');
        const dolci = allRecipes.filter(r => r.type === 'dolce');
        
        const weekMenu = [];
        const usedIds = new Set(); 

        const getUniqueRandom = (sourceArray) => {
            if (sourceArray.length === 0) return null;
            let available = sourceArray.filter(r => !usedIds.has(r.id));
            if (available.length === 0) available = sourceArray; // Reset se finiscono
            
            const selected = available[Math.floor(Math.random() * available.length)];
            usedIds.add(selected.id);
            return selected;
        };

        for (let i = 0; i < 7; i++) {
            const dayMenu = { day: i + 1, lunch: null, dinner: null };
            if (i % 2 === 0) {
                dayMenu.lunch = getUniqueRandom(primi);
                dayMenu.dinner = getUniqueRandom(secondi);
            } else {
                dayMenu.lunch = getUniqueRandom(secondi);
                dayMenu.dinner = getUniqueRandom(primi);
            }
            weekMenu.push(dayMenu);
        }

        const selectedDessert = dolci.length > 0 
            ? dolci[Math.floor(Math.random() * dolci.length)] 
            : null;

        const shoppingList = calculateShoppingList(weekMenu, selectedDessert, people);
        const stateData = { menu: weekMenu, shoppingList, dessert: selectedDessert, people };
        
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

// RIGENERA SINGOLO GIORNO
app.post('/api/regenerate-day', checkAuth, (req, res) => {
    const { day } = req.body; 

    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        
        db.all("SELECT * FROM recipes", [], (err, rows) => {
            const allRecipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            const primi = allRecipes.filter(r => r.type === 'primo');
            const secondi = allRecipes.filter(r => r.type === 'secondo');

            const dayIndex = day - 1;
            const currentDay = currentState.menu[dayIndex];
            
            const pickNew = (pool, currentId) => {
                if(pool.length <= 1) return pool[0] || null;
                const others = pool.filter(r => r.id !== currentId);
                return others[Math.floor(Math.random() * others.length)];
            };

            if (currentDay.lunch && currentDay.lunch.type === 'primo') {
                currentDay.lunch = pickNew(primi, currentDay.lunch.id);
                currentDay.dinner = pickNew(secondi, currentDay.dinner.id);
            } else {
                currentDay.lunch = pickNew(secondi, currentDay.lunch.id);
                currentDay.dinner = pickNew(primi, currentDay.dinner.id);
            }

            currentState.menu[dayIndex] = currentDay;
            currentState.shoppingList = calculateShoppingList(currentState.menu, currentState.dessert, currentState.people);

            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
                res.json(currentState);
            });
        });
    });
});

// RIGENERA DOLCE
app.post('/api/regenerate-dessert', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        
        db.all("SELECT * FROM recipes WHERE type = 'dolce'", [], (err, rows) => {
            if (rows.length === 0) return res.json(currentState);
            
            const allDesserts = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            let options = allDesserts;
            
            if (currentState.dessert && allDesserts.length > 1) {
                options = allDesserts.filter(d => d.id !== currentState.dessert.id);
            }
            
            currentState.dessert = options[Math.floor(Math.random() * options.length)];
            currentState.shoppingList = calculateShoppingList(currentState.menu, currentState.dessert, currentState.people);

            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
                res.json(currentState);
            });
        });
    });
});

// EXPORT JSON
app.get('/api/export-json', checkAuth, (req, res) => {
    db.all("SELECT name, type, servings, ingredients FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "Errore export" });
        const cleanData = rows.map(r => ({ ...r, ingredients: JSON.parse(r.ingredients) }));
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=ricette_backup.json');
        res.json(cleanData);
    });
});

// IMPORT JSON
app.post('/api/import-json', checkAuth, (req, res) => {
    const recipes = req.body;
    if (!Array.isArray(recipes)) return res.status(400).json({ error: "JSON non valido" });

    const stmt = db.prepare(`INSERT INTO recipes (name, type, servings, ingredients) VALUES (?, ?, ?, ?)`);
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        recipes.forEach(r => {
            if(r.name && r.type) {
                const ingString = typeof r.ingredients === 'object' ? JSON.stringify(r.ingredients) : r.ingredients;
                stmt.run(r.name, r.type, r.servings || 2, ingString);
            }
        });
        db.run("COMMIT", (err) => {
            stmt.finalize();
            if (err) return res.status(500).json({ error: "Errore import" });
            res.json({ message: `Importate ${recipes.length} ricette` });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Chef App attiva su http://localhost:${PORT}`);
});