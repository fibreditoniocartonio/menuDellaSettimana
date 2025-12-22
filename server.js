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

// INIZIALIZZAZIONE E MIGRATION DB
db.serialize(() => {
    // Tabella Ricette Base
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        servings INTEGER,
        ingredients TEXT,
        difficulty INTEGER DEFAULT 1,
        procedure TEXT DEFAULT ''
    )`);

    // Tabella Stato Menu
    db.run(`CREATE TABLE IF NOT EXISTS menu_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT
    )`);

    // MIGRATION: Aggiunta colonne se non esistono (per db esistenti)
    const addCol = (colSql) => {
        db.run(colSql, (err) => {
            // Ignora errore se la colonna esiste già
        });
    };
    addCol("ALTER TABLE recipes ADD COLUMN difficulty INTEGER DEFAULT 1");
    addCol("ALTER TABLE recipes ADD COLUMN procedure TEXT DEFAULT ''");
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

// Formatta stringhe (Es. "olio evo" -> "Olio Evo")
const toTitleCase = (str) => str.replace(/\b\w/g, l => l.toUpperCase());

// Algoritmo Ponderato per la selezione casuale
const getWeightedRandom = (items, usedIds) => {
    const pool = items.filter(r => !usedIds.has(r.id));
    
    if (pool.length === 0) {
        if (items.length === 0) return null;
        return items[Math.floor(Math.random() * items.length)];
    }

    const weightedPool = [];
    pool.forEach(item => {
        const weight = Math.max(1, 6 - (item.difficulty || 1)); 
        for(let k = 0; k < weight; k++) {
            weightedPool.push(item);
        }
    });

    const selected = weightedPool[Math.floor(Math.random() * weightedPool.length)];
    usedIds.add(selected.id);
    return selected;
};

// --- LOGICA LISTA DELLA SPESA AVANZATA ---
const updateShoppingItem = (list, name, qtyRaw, ratio) => {
    const key = name.trim().toLowerCase();
    const qtyNum = parseFloat(qtyRaw.toString().replace(',', '.'));
    
    if (!list[key]) list[key] = { total: 0, isQb: false, originalName: name };

    if (isNaN(qtyNum)) {
        list[key].isQb = true;
    } else {
        list[key].total += (qtyNum * ratio);
    }
};

function calculateShoppingList(menu, dessert, people, dessertPeople, oldState = {}) {
    // Recuperiamo lo stato precedente della lista 'main'
    const oldMain = oldState.shoppingList ? (oldState.shoppingList.main || {}) : {};
    
    // Le modifiche manuali e gli extra vengono passati dall'esterno (già elaborati nel generate-menu)
    const overrides = oldState.shoppingOverrides || {};
    const extras = oldState.shoppingExtras || [];

    // Usiamo un unico accumulatore per tutto
    const listCombinedRaw = {};

    // 1. Calcolo matematico Pasti (Pranzo/Cena)
    menu.forEach(day => {
        ['lunch', 'dinner'].forEach(slot => {
            const meal = day[slot];
            if (meal) {
                const mealPeople = meal.customServings ? meal.customServings : people;
                const ratio = mealPeople / meal.servings;
                const ingredients = typeof meal.ingredients === 'string' ? JSON.parse(meal.ingredients) : meal.ingredients;
                ingredients.forEach(ing => {
                    updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, ratio);
                });
            }
        });
    });

    // 2. Calcolo matematico Dolce (Aggiunto alla stessa lista)
    if(dessert) {
        const dRatio = (dessertPeople || people) / dessert.servings;
        const ingredients = typeof dessert.ingredients === 'string' ? JSON.parse(dessert.ingredients) : dessert.ingredients;
        ingredients.forEach(ing => {
            updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, dRatio);
        });
    }

    // Funzione helper per formattare la lista finale
    const formatList = (rawList, oldListRef, category) => {
        const finalObj = {};
        Object.keys(rawList).sort().forEach(k => {
            const item = rawList[k];
            const titleKey = toTitleCase(item.originalName);
            
            const overrideKey = `${category}_${titleKey}`;
            const hasOverride = overrides.hasOwnProperty(overrideKey);
            
            let displayQty;
            if (hasOverride) {
                displayQty = overrides[overrideKey];
            } else {
                displayQty = item.isQb ? "q.b." : Math.ceil(item.total);
            }

            const oldItem = oldListRef[titleKey];
            let isChecked = false;
            
            if (oldItem && oldItem.checked) {
                if (hasOverride || item.isQb) {
                    isChecked = true;
                } else {
                    const oldQtyNum = parseFloat(oldItem.qty);
                    if (!isNaN(oldQtyNum) && Math.ceil(item.total) <= oldQtyNum) {
                        isChecked = true;
                    }
                }
            }

            finalObj[titleKey] = {
                qty: displayQty,
                checked: isChecked,
                isModified: hasOverride
            };
        });
        return finalObj;
    };

    return {
        shoppingList: {
            main: formatList(listCombinedRaw, oldMain, 'main') 
        },
        shoppingOverrides: overrides,
        shoppingExtras: extras 
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

// --- ROTTE RICETTE ---

app.get('/api/recipes', checkAuth, (req, res) => {
    db.all("SELECT * FROM recipes ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const recipes = rows.map(r => ({
            ...r, 
            ingredients: JSON.parse(r.ingredients)
        }));
        res.json(recipes);
    });
});

app.post('/api/recipes', checkAuth, (req, res) => {
    const { name, type, servings, ingredients, difficulty, procedure } = req.body;
    const ingJson = JSON.stringify(ingredients);
    const diffVal = difficulty || 1;
    const procVal = procedure || "";
    
    db.run(`INSERT INTO recipes (name, type, servings, ingredients, difficulty, procedure) VALUES (?, ?, ?, ?, ?, ?)`, 
        [name, type, servings, ingJson, diffVal, procVal], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: "Ricetta aggiunta" });
        }
    );
});

app.put('/api/recipes/:id', checkAuth, (req, res) => {
    const { name, type, servings, ingredients, difficulty, procedure } = req.body;
    const ingJson = JSON.stringify(ingredients);
    const diffVal = difficulty || 1;
    const procVal = procedure || "";
    
    db.run(`UPDATE recipes SET name = ?, type = ?, servings = ?, ingredients = ?, difficulty = ?, procedure = ? WHERE id = ?`,
        [name, type, servings, ingJson, diffVal, procVal, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Ricetta aggiornata" });
        }
    );
});

app.delete('/api/recipes/:id', checkAuth, (req, res) => {
    db.run(`DELETE FROM recipes WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Ricetta eliminata" });
    });
});

// --- ROTTE MENU ---

app.post('/api/generate-menu', checkAuth, (req, res) => {
    const { people } = req.body;

    // PRIMA DI GENERARE: Recuperiamo lo stato precedente per salvare gli Extra e le Modifiche
    db.get("SELECT data FROM menu_state WHERE id = 1", (errState, rowState) => {
        
        // Prepariamo gli extra da preservare
        let preservedExtras = [];
        
        if (!errState && rowState && rowState.data) {
            try {
                const oldData = JSON.parse(rowState.data);
                
                // 1. Manteniamo gli extra già esistenti
                if (oldData.shoppingExtras && Array.isArray(oldData.shoppingExtras)) {
                    preservedExtras = [...oldData.shoppingExtras];
                }

                // 2. Convertiamo gli override (modifiche manuali) in nuovi Extra
                // Perché se rigenero il menu, quella modifica era una volontà specifica dell'utente
                // e non deve andare persa.
                if (oldData.shoppingOverrides) {
                    Object.keys(oldData.shoppingOverrides).forEach(key => {
                        // La chiave è tipo "main_Farina"
                        const pureName = key.split('_')[1] || key;
                        const qty = oldData.shoppingOverrides[key];
                        
                        // Aggiungiamo come extra
                        preservedExtras.push({
                            id: Date.now() + Math.random(), // ID univoco temporaneo
                            name: pureName,
                            qty: qty,
                            checked: false
                        });
                    });
                }
            } catch (e) {
                console.error("Errore parsing vecchio stato", e);
            }
        }

        // Ora generiamo il nuovo menu
        db.all("SELECT * FROM recipes", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            if (rows.length < 2) return res.status(400).json({ error: "Inserisci almeno un po' di ricette prima!" });
            
            const allRecipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            const primi = allRecipes.filter(r => r.type === 'primo');
            const secondi = allRecipes.filter(r => r.type === 'secondo');
            const dolci = allRecipes.filter(r => r.type === 'dolce');
            
            const weekMenu = [];
            const usedIds = new Set(); 

            for (let i = 0; i < 7; i++) {
                const dayMenu = { day: i + 1, lunch: null, dinner: null };
                if (i % 2 === 0) {
                    dayMenu.lunch = getWeightedRandom(primi, usedIds);
                    dayMenu.dinner = getWeightedRandom(secondi, usedIds);
                } else {
                    dayMenu.lunch = getWeightedRandom(secondi, usedIds);
                    dayMenu.dinner = getWeightedRandom(primi, usedIds);
                }
                weekMenu.push(dayMenu);
            }

            const selectedDessert = getWeightedRandom(dolci, new Set()); 
            const dessertPeople = people;

            // Passiamo i preservedExtras nel nuovo stato.
            // Passiamo shoppingOverrides vuoto ({}) perché gli override vecchi sono diventati extra.
            const tempState = { 
                shoppingExtras: preservedExtras, 
                shoppingOverrides: {} 
            };

            const calculated = calculateShoppingList(weekMenu, selectedDessert, people, dessertPeople, tempState);
            
            const stateData = { 
                menu: weekMenu, 
                shoppingList: calculated.shoppingList, 
                shoppingOverrides: calculated.shoppingOverrides, // Sarà vuoto, pulito
                shoppingExtras: calculated.shoppingExtras,     // Conterrà vecchi extra + vecchi override
                dessert: selectedDessert, 
                people, 
                dessertPeople 
            };
            
            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(stateData)], (e) => {
                if (e) console.error(e);
                res.json(stateData);
            });
        });
    });
});

app.get('/api/last-menu', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.json(null);
        res.json(JSON.parse(row.data));
    });
});

// --- GESTIONE SPESA (Azioni) ---

app.post('/api/toggle-shopping-item', checkAuth, (req, res) => {
    const { category, item, isExtra } = req.body; 
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        
        if (isExtra) {
            const extraItem = currentState.shoppingExtras.find(e => e.name === item);
            if(extraItem) extraItem.checked = !extraItem.checked;
        } else {
            // Nota: category sarà 'main'
            if (currentState.shoppingList[category] && currentState.shoppingList[category][item]) {
                currentState.shoppingList[category][item].checked = !currentState.shoppingList[category][item].checked;
            }
        }
            
        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
            res.json(currentState);
        });
    });
});

app.post('/api/update-shopping-qty', checkAuth, (req, res) => {
    const { category, item, newQty } = req.body; 
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        
        const overrideKey = `${category}_${item}`;
        
        if (!currentState.shoppingOverrides) currentState.shoppingOverrides = {};
        currentState.shoppingOverrides[overrideKey] = newQty;

        const recalculated = calculateShoppingList(
            currentState.menu, 
            currentState.dessert, 
            currentState.people, 
            currentState.dessertPeople,
            currentState 
        );

        currentState.shoppingList = recalculated.shoppingList;
        currentState.shoppingOverrides = recalculated.shoppingOverrides;

        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
            res.json(currentState);
        });
    });
});

app.post('/api/add-shopping-extra', checkAuth, (req, res) => {
    const { name, qty } = req.body;
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        if (!currentState.shoppingExtras) currentState.shoppingExtras = [];

        currentState.shoppingExtras.push({
            id: Date.now(), 
            name: toTitleCase(name),
            qty: qty,
            checked: false
        });

        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
            res.json(currentState);
        });
    });
});

app.post('/api/remove-shopping-extra', checkAuth, (req, res) => {
    const { id } = req.body;
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        if (currentState.shoppingExtras) {
            currentState.shoppingExtras = currentState.shoppingExtras.filter(e => e.id !== id);
        }

        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
            res.json(currentState);
        });
    });
});

// NUOVA ROTTA: Pulisci tutta la lista extra
app.post('/api/clear-shopping-extras', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Nessun menu attivo" });
        
        let currentState = JSON.parse(rowState.data);
        currentState.shoppingExtras = []; // Reset array

        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
            res.json(currentState);
        });
    });
});


// --- AGGIORNAMENTI MENU ---

const updateStateAndRespond = (res, newState) => {
    const recalculated = calculateShoppingList(
        newState.menu,
        newState.dessert,
        newState.people,
        newState.dessertPeople,
        newState 
    );

    newState.shoppingList = recalculated.shoppingList;
    newState.shoppingOverrides = recalculated.shoppingOverrides;
    newState.shoppingExtras = recalculated.shoppingExtras;

    db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(newState)], () => {
        res.json(newState);
    });
};

app.post('/api/update-meal-servings', checkAuth, (req, res) => {
    const { day, type, servings } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(rowState.data);
        if(s.menu[day-1] && s.menu[day-1][type]) {
            s.menu[day-1][type].customServings = parseInt(servings);
            updateStateAndRespond(res, s);
        }
    });
});

app.post('/api/regenerate-meal', checkAuth, (req, res) => {
    const { day, type } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(rowState.data);
        const currentMeal = s.menu[day-1][type];
        if(!currentMeal) return res.status(400).json({error: "Empty"});

        db.all("SELECT * FROM recipes WHERE type = ?", [currentMeal.type], (err, rows) => {
            const all = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            const pool = all.filter(r => r.id !== currentMeal.id);
            const newRecipe = getWeightedRandom(pool, new Set()) || currentMeal;
            
            if(currentMeal.customServings) newRecipe.customServings = currentMeal.customServings;
            s.menu[day-1][type] = newRecipe;
            updateStateAndRespond(res, s);
        });
    });
});

app.post('/api/set-manual-meal', checkAuth, (req, res) => {
    const { day, type, recipeId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(rowState.data);
        
        db.get("SELECT * FROM recipes WHERE id = ?", [recipeId], (err, row) => {
            if(!row) return res.status(400).json({error: "No Recipe"});
            const newR = {...row, ingredients: JSON.parse(row.ingredients)};
            const old = s.menu[day-1][type];
            if(old && old.customServings) newR.customServings = old.customServings;
            
            s.menu[day-1][type] = newR;
            updateStateAndRespond(res, s);
        });
    });
});

app.post('/api/regenerate-dessert', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(rowState.data);
        db.all("SELECT * FROM recipes WHERE type = 'dolce'", [], (err, rows) => {
            const all = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            const pool = s.dessert ? all.filter(r => r.id !== s.dessert.id) : all;
            s.dessert = getWeightedRandom(pool, new Set());
            if(!s.dessertPeople) s.dessertPeople = s.people;
            updateStateAndRespond(res, s);
        });
    });
});

app.post('/api/update-dessert-servings', checkAuth, (req, res) => {
    const { servings } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(rowState.data);
        s.dessertPeople = parseInt(servings);
        updateStateAndRespond(res, s);
    });
});

app.post('/api/set-manual-dessert', checkAuth, (req, res) => {
    const { recipeId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, rowState) => {
        if (err || !rowState) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(rowState.data);
        db.get("SELECT * FROM recipes WHERE id = ?", [recipeId], (err, row) => {
            if(!row) return res.status(400).json({error: "No Recipe"});
            s.dessert = {...row, ingredients: JSON.parse(row.ingredients)};
            if(!s.dessertPeople) s.dessertPeople = s.people;
            updateStateAndRespond(res, s);
        });
    });
});

// IMPORT / EXPORT
app.get('/api/export-json', checkAuth, (req, res) => {
    db.all("SELECT name, type, servings, ingredients, difficulty, procedure FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "Errore export" });
        const cleanData = rows.map(r => ({ 
            ...r, 
            ingredients: JSON.parse(r.ingredients) 
        }));
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=ricettario_backup.json');
        res.json(cleanData);
    });
});

app.post('/api/import-json', checkAuth, (req, res) => {
    const recipes = req.body;
    if (!Array.isArray(recipes)) return res.status(400).json({ error: "JSON non valido" });

    const stmt = db.prepare(`INSERT INTO recipes (name, type, servings, ingredients, difficulty, procedure) VALUES (?, ?, ?, ?, ?, ?)`);
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        recipes.forEach(r => {
            if(r.name && r.type) {
                const ingString = typeof r.ingredients === 'object' ? JSON.stringify(r.ingredients) : r.ingredients;
                const diff = r.difficulty || 1;
                const proc = r.procedure || "";
                stmt.run(r.name, r.type, r.servings || 2, ingString, diff, proc);
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