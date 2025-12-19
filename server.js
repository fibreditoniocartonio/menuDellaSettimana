const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();    
const PORT = process.env.PORT || 3000;
const HOST = process.env.IP || "0.0.0.0";


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

// Helper per formattare la lista con "Safety Uncheck"
const formatList = (rawList, oldList = {}) => {
    const finalObj = {};
    Object.keys(rawList).sort().forEach(k => {
        const item = rawList[k]; // item.total è il NUOVO numero calcolato
        const titleKey = toTitleCase(k);
        const oldItem = oldList[titleKey];
        
        // Calcolo la nuova quantità visualizzata
        const newQtyDisplay = item.isQb ? "q.b." : Math.ceil(item.total);

        let isChecked = false;

        // Se l'item esisteva ed era spuntato, facciamo il controllo di sicurezza
        if (oldItem && oldItem.checked) {
            if (item.isQb) {
                // Se è "quanto basta" (es. sale, olio), manteniamo la spunta
                isChecked = true;
            } else {
                // Recuperiamo la vecchia quantità numerica (togliendo eventuali "q.b." o testi)
                const oldQtyNum = parseFloat(oldItem.qty);
                
                // Se la conversione fallisce o se la nuova quantità è MAGGIORE della vecchia
                // togliamo la spunta per sicurezza.
                if (!isNaN(oldQtyNum) && Math.ceil(item.total) <= oldQtyNum) {
                    isChecked = true;
                }
                // ALTRIMENTI: isChecked rimane false (Reset di sicurezza)
            }
        }

        finalObj[titleKey] = {
            qty: newQtyDisplay,
            checked: isChecked
        };
    });
    return finalObj;
};

// Helper: Ricalcola lista della spesa 
// Accetta oldShoppingList per preservare le spunte durante i ricalcoli
function calculateShoppingList(menu, dessert, people, dessertPeople, oldShoppingList = { main: {}, dessert: {} }) {
    const listMainRaw = {};
    const listDessertRaw = {};

    // 1. Calcola Pasti Principali
    menu.forEach(day => {
        ['lunch', 'dinner'].forEach(slot => {
            const meal = day[slot];
            if (meal) {
                const mealPeople = meal.customServings ? meal.customServings : people;
                const ratio = mealPeople / meal.servings;
                
                meal.ingredients.forEach(ing => {
                    updateShoppingList(listMainRaw, ing.name, ing.quantity, ratio);
                });
            }
        });
    });

    // 2. Calcola Dolce
    if(dessert) {
        const dRatio = (dessertPeople || people) / dessert.servings;
        dessert.ingredients.forEach(ing => {
            updateShoppingList(listDessertRaw, ing.name, ing.quantity, dRatio);
        });
    }

    return {
        main: formatList(listMainRaw, oldShoppingList.main || {}),
        dessert: formatList(listDessertRaw, oldShoppingList.dessert || {})
    };
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

// GENERA MENU COMPLETO
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
            if (available.length === 0) available = sourceArray; 
            
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

        const dessertPeople = people;

        // Nuova generazione: non passiamo oldList perché è un menu completamente nuovo
        const shoppingList = calculateShoppingList(weekMenu, selectedDessert, people, dessertPeople);
        const stateData = { menu: weekMenu, shoppingList, dessert: selectedDessert, people, dessertPeople };
        
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

// --- TOGGLE SHOPPING ITEM (NUOVO) ---
app.post('/api/toggle-shopping-item', checkAuth, (req, res) => {
    const { category, item } = req.body; // category: 'main' o 'dessert', item: 'Nome Ingrediente'
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        
        // Controlla se l'elemento esiste nella lista
        if (currentState.shoppingList[category] && currentState.shoppingList[category][item]) {
            // Inverti lo stato checked
            currentState.shoppingList[category][item].checked = !currentState.shoppingList[category][item].checked;
            
            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
                res.json(currentState);
            });
        } else {
            res.status(404).json({ error: "Ingrediente non trovato" });
        }
    });
});

// --- Aggiorna porzioni singolo pasto ---
app.post('/api/update-meal-servings', checkAuth, (req, res) => {
    const { day, type, servings } = req.body;
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        const dayIndex = day - 1;
        
        if(currentState.menu[dayIndex] && currentState.menu[dayIndex][type]) {
            currentState.menu[dayIndex][type].customServings = parseInt(servings);
            
            // Passiamo la vecchia lista per preservare le spunte
            currentState.shoppingList = calculateShoppingList(
                currentState.menu, 
                currentState.dessert, 
                currentState.people, 
                currentState.dessertPeople,
                currentState.shoppingList // <--- Passiamo lo stato precedente
            );
            
            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
                res.json(currentState);
            });
        } else {
            res.status(400).json({ error: "Pasto non trovato" });
        }
    });
});

// --- Rigenera Singolo Piatto ---
app.post('/api/regenerate-meal', checkAuth, (req, res) => {
    const { day, type } = req.body;

    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        const dayIndex = day - 1;
        const currentMeal = currentState.menu[dayIndex][type];
        
        if(!currentMeal) return res.status(400).json({error: "Pasto vuoto"});

        const targetType = currentMeal.type;

        db.all("SELECT * FROM recipes WHERE type = ?", [targetType], (err, rows) => {
            if (rows.length === 0) return res.json(currentState);

            const allOptions = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            let pool = allOptions.filter(r => r.id !== currentMeal.id);
            if(pool.length === 0) pool = allOptions; 

            const newRecipe = pool[Math.floor(Math.random() * pool.length)];
            
            if(currentMeal.customServings) {
                newRecipe.customServings = currentMeal.customServings;
            }

            currentState.menu[dayIndex][type] = newRecipe;
            currentState.shoppingList = calculateShoppingList(
                currentState.menu, 
                currentState.dessert, 
                currentState.people, 
                currentState.dessertPeople,
                currentState.shoppingList // Preserva spunte
            );

            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
                res.json(currentState);
            });
        });
    });
});

// --- Imposta Piatto Manuale ---
app.post('/api/set-manual-meal', checkAuth, (req, res) => {
    const { day, type, recipeId } = req.body;
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        let currentState = JSON.parse(rowState.data);
        const dayIndex = day - 1;

        db.get("SELECT * FROM recipes WHERE id = ?", [recipeId], (err, row) => {
            if(err || !row) return res.status(400).json({error: "Ricetta non trovata"});
            
            const newRecipe = {...row, ingredients: JSON.parse(row.ingredients)};
            const oldMeal = currentState.menu[dayIndex][type];

            if(oldMeal && oldMeal.customServings) {
                newRecipe.customServings = oldMeal.customServings;
            }

            currentState.menu[dayIndex][type] = newRecipe;
            currentState.shoppingList = calculateShoppingList(
                currentState.menu, 
                currentState.dessert, 
                currentState.people, 
                currentState.dessertPeople,
                currentState.shoppingList // Preserva spunte
            );

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
            if(!currentState.dessertPeople) currentState.dessertPeople = currentState.people;

            currentState.shoppingList = calculateShoppingList(
                currentState.menu, 
                currentState.dessert, 
                currentState.people, 
                currentState.dessertPeople,
                currentState.shoppingList // Preserva spunte
            );

            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
                res.json(currentState);
            });
        });
    });
});

// AGGIORNA PORZIONI DOLCE
app.post('/api/update-dessert-servings', checkAuth, (req, res) => {
    const { servings } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        currentState.dessertPeople = parseInt(servings);
        
        currentState.shoppingList = calculateShoppingList(
            currentState.menu, 
            currentState.dessert, 
            currentState.people, 
            currentState.dessertPeople,
            currentState.shoppingList // Preserva spunte
        );

        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
            res.json(currentState);
        });
    });
});

// IMPOSTA DOLCE MANUALE
app.post('/api/set-manual-dessert', checkAuth, (req, res) => {
    const { recipeId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);

        db.get("SELECT * FROM recipes WHERE id = ?", [recipeId], (err, row) => {
            if(err || !row) return res.status(400).json({error: "Ricetta non trovata"});
            
            const newDessert = {...row, ingredients: JSON.parse(row.ingredients)};
            currentState.dessert = newDessert;
            if(!currentState.dessertPeople) currentState.dessertPeople = currentState.people;
            
            currentState.shoppingList = calculateShoppingList(
                currentState.menu, 
                currentState.dessert, 
                currentState.people, 
                currentState.dessertPeople,
                currentState.shoppingList // Preserva spunte
            );

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
    console.log(`Chef App attiva su http://[${HOST}]:${PORT}`);
});