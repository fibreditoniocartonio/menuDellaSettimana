const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); 

const app = express();    
const PORT = process.env.PORT || 3000;
const HOST = process.env.IP || "0.0.0.0";

// CONFIGURAZIONE
const SECRET_CODE = "0902"; 

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'recipes.db');

if (!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR);
    console.log("Cartella 'data' creata.");
}

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); 
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_FILE);

// INIZIALIZZAZIONE
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        servings INTEGER,
        ingredients TEXT,
        difficulty INTEGER DEFAULT 1,
        procedure TEXT DEFAULT ''
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS menu_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT
    )`);

    const addCol = (colSql) => {
        db.run(colSql, (err) => {});
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
const toTitleCase = (str) => str.replace(/\b\w/g, l => l.toUpperCase());

// Algoritmo Ponderato
const getWeightedRandom = (items, usedIds) => {
    // Filtra items già usati se possibile, altrimenti resetta pool locale per questa scelta
    let pool = items.filter(r => !usedIds.has(r.id));
    if (pool.length === 0) pool = items; // Se finiti, riusa tutti
    if (pool.length === 0) return null;

    const weightedPool = [];
    pool.forEach(item => {
        const weight = Math.max(1, 6 - (item.difficulty || 1)); 
        for(let k = 0; k < weight; k++) {
            weightedPool.push(item);
        }
    });

    const selected = weightedPool[Math.floor(Math.random() * weightedPool.length)];
    if(selected) usedIds.add(selected.id);
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

// Helper per processare ricette singole o array di items (composite)
const processRecipeForShopping = (recipeOrMeal, listCombinedRaw, people) => {
    if (!recipeOrMeal) return;

    // Se è un pasto composito (es. Secondo + Contorno) ha la proprietà 'items'
    if (recipeOrMeal.items && Array.isArray(recipeOrMeal.items)) {
        recipeOrMeal.items.forEach(subItem => {
            // Ricorsione per ogni sotto-elemento
            // Nota: customServings si applica al gruppo, quindi lo passiamo
            const itemPeople = recipeOrMeal.customServings || people;
            const ratio = itemPeople / (subItem.servings || 2); // fallback servings
            const ingredients = typeof subItem.ingredients === 'string' ? JSON.parse(subItem.ingredients) : subItem.ingredients;
            
            ingredients.forEach(ing => {
                updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, ratio);
            });
        });
    } else {
        // Ricetta singola standard
        const mealPeople = recipeOrMeal.customServings || people;
        const ratio = mealPeople / recipeOrMeal.servings;
        const ingredients = typeof recipeOrMeal.ingredients === 'string' ? JSON.parse(recipeOrMeal.ingredients) : recipeOrMeal.ingredients;
        
        ingredients.forEach(ing => {
            updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, ratio);
        });
    }
};

function calculateShoppingList(menu, dessert, extraMeals, people, dessertPeople, oldState = {}) {
    const oldMain = oldState.shoppingList ? (oldState.shoppingList.main || {}) : {};
    const overrides = oldState.shoppingOverrides || {};
    const extras = oldState.shoppingExtras || []; // Lista manuale (carta igienica, ecc.)

    const listCombinedRaw = {};

    // 1. Pasti Settimanali
    menu.forEach(day => {
        ['lunch', 'dinner'].forEach(slot => {
            processRecipeForShopping(day[slot], listCombinedRaw, people);
        });
    });

    // 2. Pasti Extra (Aggiunti manualmente)
    if (extraMeals && Array.isArray(extraMeals)) {
        extraMeals.forEach(meal => {
            processRecipeForShopping(meal, listCombinedRaw, meal.customServings || people);
        });
    }

    // 3. Dolce
    if(dessert) {
        // Il dolce è trattato come una ricetta singola
        const dRatio = (dessertPeople || people) / dessert.servings;
        const ingredients = typeof dessert.ingredients === 'string' ? JSON.parse(dessert.ingredients) : dessert.ingredients;
        ingredients.forEach(ing => {
            updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, dRatio);
        });
    }

    // Formattazione finale
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
    if (code === SECRET_CODE) res.json({ token: SECRET_CODE });
    else res.status(401).json({ error: "Codice errato" });
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
    db.run(`INSERT INTO recipes (name, type, servings, ingredients, difficulty, procedure) VALUES (?, ?, ?, ?, ?, ?)`, 
        [name, type, servings, JSON.stringify(ingredients), difficulty || 1, procedure || ""], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.put('/api/recipes/:id', checkAuth, (req, res) => {
    const { name, type, servings, ingredients, difficulty, procedure } = req.body;
    db.run(`UPDATE recipes SET name = ?, type = ?, servings = ?, ingredients = ?, difficulty = ?, procedure = ? WHERE id = ?`,
        [name, type, servings, JSON.stringify(ingredients), difficulty || 1, procedure || "", req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "OK" });
        }
    );
});

app.delete('/api/recipes/:id', checkAuth, (req, res) => {
    db.run(`DELETE FROM recipes WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "OK" });
    });
});

// --- ROTTE MENU ---

app.post('/api/generate-menu', checkAuth, (req, res) => {
    const { people } = req.body;

    db.get("SELECT data FROM menu_state WHERE id = 1", (errState, rowState) => {
        let preservedExtras = [];
        let shoppingOverrides = {}; // Manteniamo gli override se possibile, o reset? Meglio reset su genera nuovo.
        
        // Manteniamo solo la lista spesa manuale (carta igienica, etc), non i piatti extra
        if (!errState && rowState && rowState.data) {
            try {
                const oldData = JSON.parse(rowState.data);
                if (oldData.shoppingExtras) preservedExtras = [...oldData.shoppingExtras];
                // Nota: extraMeals (piatti manuali) vengono resettati come richiesto.
            } catch (e) {}
        }

        db.all("SELECT * FROM recipes", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            if (rows.length < 2) return res.status(400).json({ error: "Poche ricette nel DB!" });
            
            const allRecipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            
            // Categorie richieste
            const primi = allRecipes.filter(r => r.type === 'primo');
            const secondi = allRecipes.filter(r => r.type === 'secondo');
            const contorni = allRecipes.filter(r => r.type === 'contorno');
            const secondiCompleti = allRecipes.filter(r => r.type === 'secondo_completo');
            const dolci = allRecipes.filter(r => r.type === 'dolce');
            // Antipasti e preparazioni non usati nel menu automatico per ora, ma disponibili per manuale

            const weekMenu = [];
            const usedIds = new Set(); 

            for (let i = 0; i < 7; i++) {
                const dayMenu = { day: i + 1, lunch: null, dinner: null };
                
                // PRANZO: Sempre Primo (per ora, futuro estendibile a array)
                const pickedPrimo = getWeightedRandom(primi, usedIds);
                // Salviamo come oggetto singolo per compatibilità, o array items per coerenza?
                // Manteniamo struttura singola se semplice, ma la UI ora supporta items.
                // Per uniformità usiamo items anche qui? No, lasciamo misto per ora:
                // Se items esiste è composito, altrimenti singolo.
                dayMenu.lunch = pickedPrimo;

                // CENA: Algoritmo Scelta
                // Opzione A: Secondo Completo
                // Opzione B: Secondo + Contorno
                // Probabilità 50% (se ci sono abbastanza ricette)
                const useComplete = (Math.random() > 0.5 && secondiCompleti.length > 0) || (secondi.length === 0);
                
                if (useComplete && secondiCompleti.length > 0) {
                    dayMenu.dinner = getWeightedRandom(secondiCompleti, usedIds);
                } else {
                    // Secondo + Contorno
                    const sec = getWeightedRandom(secondi, usedIds);
                    const cont = getWeightedRandom(contorni, usedIds); // I contorni si possono ripetere più facilmente? Usiamo same usedIds
                    
                    if (sec) {
                        if (cont) {
                            // Creiamo oggetto composito
                            dayMenu.dinner = {
                                isComposite: true,
                                name: `${sec.name} + ${cont.name}`, // Nome visuale fallback
                                items: [sec, cont],
                                difficulty: Math.max(sec.difficulty, cont.difficulty)
                            };
                        } else {
                            dayMenu.dinner = sec; // Solo secondo se mancano contorni
                        }
                    } else {
                        dayMenu.dinner = null; // Fallback estremo
                    }
                }
                weekMenu.push(dayMenu);
            }

            const selectedDessert = getWeightedRandom(dolci, new Set()); 
            const dessertPeople = people;
            const extraMeals = []; // Vuoto su nuova generazione

            const tempState = { shoppingExtras: preservedExtras, shoppingOverrides: {} };

            const calculated = calculateShoppingList(weekMenu, selectedDessert, extraMeals, people, dessertPeople, tempState);
            
            const stateData = { 
                menu: weekMenu, 
                extraMeals: extraMeals,
                shoppingList: calculated.shoppingList, 
                shoppingOverrides: calculated.shoppingOverrides, 
                shoppingExtras: calculated.shoppingExtras,     
                dessert: selectedDessert, 
                people, 
                dessertPeople 
            };
            
            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(stateData)], (e) => {
                res.json(stateData);
            });
        });
    });
});

app.get('/api/last-menu', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.json(null);
        res.json(JSON.parse(row.data));
    });
});

// --- GESTIONE SPESA ---
const saveState = (res, newState) => {
    const recalculated = calculateShoppingList(
        newState.menu,
        newState.dessert,
        newState.extraMeals,
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

app.post('/api/toggle-shopping-item', checkAuth, (req, res) => {
    const { category, item, isExtra } = req.body; 
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        if (isExtra) {
            const e = s.shoppingExtras.find(x => x.name === item);
            if(e) e.checked = !e.checked;
        } else {
            if (s.shoppingList[category][item]) s.shoppingList[category][item].checked = !s.shoppingList[category][item].checked;
        }
        saveState(res, s);
    });
});

app.post('/api/update-shopping-qty', checkAuth, (req, res) => {
    const { category, item, newQty } = req.body; 
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        if (!s.shoppingOverrides) s.shoppingOverrides = {};
        s.shoppingOverrides[`${category}_${item}`] = newQty;
        saveState(res, s);
    });
});

app.post('/api/add-shopping-extra', checkAuth, (req, res) => {
    const { name, qty } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        if (!s.shoppingExtras) s.shoppingExtras = [];
        s.shoppingExtras.push({ id: Date.now(), name: toTitleCase(name), qty, checked: false });
        saveState(res, s);
    });
});

app.post('/api/remove-shopping-extra', checkAuth, (req, res) => {
    const { id } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        s.shoppingExtras = s.shoppingExtras.filter(e => e.id !== id);
        saveState(res, s);
    });
});

app.post('/api/clear-shopping-extras', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        s.shoppingExtras = []; 
        saveState(res, s);
    });
});

// --- UPDATES MENU ---

app.post('/api/update-meal-servings', checkAuth, (req, res) => {
    const { day, type, servings, extraId } = req.body; // extraId se è un pasto extra
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        
        if (extraId) {
            const extra = s.extraMeals.find(e => e.uniqueId == extraId);
            if(extra) extra.customServings = parseInt(servings);
        } else {
            if(s.menu[day-1] && s.menu[day-1][type]) {
                s.menu[day-1][type].customServings = parseInt(servings);
            }
        }
        saveState(res, s);
    });
});

app.post('/api/regenerate-meal', checkAuth, (req, res) => {
    const { day, type } = req.body;
    // NOTA: Questa funzione ora rigenera l'intero slot seguendo la logica "algoritmo"
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        
        // Recuperiamo tutte le ricette per fare la scelta
        db.all("SELECT * FROM recipes", [], (dberr, rows) => {
            const allRecipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            
            if (type === 'lunch') {
                // Logica PRANZO: Primo
                const primi = allRecipes.filter(r => r.type === 'primo');
                const newR = getWeightedRandom(primi, new Set()); // No history check per semplicità su regen singolo
                if (newR) {
                     // Mantieni servings custom se c'erano
                     if(s.menu[day-1].lunch && s.menu[day-1].lunch.customServings) {
                        newR.customServings = s.menu[day-1].lunch.customServings;
                     }
                     s.menu[day-1].lunch = newR;
                }
            } else if (type === 'dinner') {
                // Logica CENA: Completo o Combo
                const secondi = allRecipes.filter(r => r.type === 'secondo');
                const contorni = allRecipes.filter(r => r.type === 'contorno');
                const completi = allRecipes.filter(r => r.type === 'secondo_completo');
                
                const useComplete = (Math.random() > 0.5 && completi.length > 0) || (secondi.length === 0);
                let newMeal = null;

                if (useComplete) {
                    newMeal = getWeightedRandom(completi, new Set());
                } else {
                    const sec = getWeightedRandom(secondi, new Set());
                    const cont = getWeightedRandom(contorni, new Set());
                    if (sec && cont) {
                        newMeal = {
                            isComposite: true,
                            name: `${sec.name} + ${cont.name}`,
                            items: [sec, cont],
                            difficulty: Math.max(sec.difficulty, cont.difficulty)
                        };
                    } else if (sec) {
                        newMeal = sec;
                    }
                }

                if (newMeal) {
                    if(s.menu[day-1].dinner && s.menu[day-1].dinner.customServings) {
                        newMeal.customServings = s.menu[day-1].dinner.customServings;
                    }
                    s.menu[day-1].dinner = newMeal;
                }
            }
            saveState(res, s);
        });
    });
});

app.post('/api/set-manual-meal', checkAuth, (req, res) => {
    const { day, type, recipeId, extraId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        
        db.get("SELECT * FROM recipes WHERE id = ?", [recipeId], (err, dbR) => {
            if(!dbR) return res.status(400).json({error: "No Recipe"});
            const newR = {...dbR, ingredients: JSON.parse(dbR.ingredients)};
            
            if (extraId) {
                // Stiamo sostituendo un pasto extra
                const idx = s.extraMeals.findIndex(e => e.uniqueId == extraId);
                if (idx >= 0) {
                    newR.uniqueId = extraId;
                    newR.customServings = s.extraMeals[idx].customServings;
                    s.extraMeals[idx] = newR;
                }
            } else {
                // Stiamo sostituendo un pasto calendario
                const old = s.menu[day-1][type];
                if(old && old.customServings) newR.customServings = old.customServings;
                s.menu[day-1][type] = newR;
            }
            saveState(res, s);
        });
    });
});

// --- PASTI EXTRA (MANUAL ADD) ---
app.post('/api/add-manual-meal', checkAuth, (req, res) => {
    const { recipeId } = req.body; // Se vuoto crea placeholder? No, obbliga scelta.
    // In realtà, la UI prima mostra la lista, poi chiama questo.
    // Ma se volessimo aggiungere un "slot" vuoto e poi riempirlo?
    // Facciamo che questa API riceve un recipeId e lo aggiunge agli extra.
    
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        if (!s.extraMeals) s.extraMeals = [];

        db.get("SELECT * FROM recipes WHERE id = ?", [recipeId], (err, dbR) => {
            if(!dbR) return res.status(400).json({error: "Recipe not found"});
            
            const newR = {...dbR, ingredients: JSON.parse(dbR.ingredients)};
            newR.uniqueId = Date.now(); // ID univoco per gestione UI
            newR.customServings = s.people; // Default alle persone globali

            s.extraMeals.push(newR);
            saveState(res, s);
        });
    });
});

app.post('/api/remove-manual-meal', checkAuth, (req, res) => {
    const { uniqueId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        if (s.extraMeals) {
            s.extraMeals = s.extraMeals.filter(m => m.uniqueId != uniqueId);
        }
        saveState(res, s);
    });
});

// --- DOLCE ---
app.post('/api/regenerate-dessert', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        let s = JSON.parse(row.data);
        db.all("SELECT * FROM recipes WHERE type = 'dolce'", [], (err, rows) => {
            const all = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            const pool = s.dessert ? all.filter(r => r.id !== s.dessert.id) : all;
            s.dessert = getWeightedRandom(pool, new Set());
            if(!s.dessertPeople) s.dessertPeople = s.people;
            saveState(res, s);
        });
    });
});

app.post('/api/update-dessert-servings', checkAuth, (req, res) => {
    const { servings } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        let s = JSON.parse(row.data);
        s.dessertPeople = parseInt(servings);
        saveState(res, s);
    });
});

app.post('/api/set-manual-dessert', checkAuth, (req, res) => {
    const { recipeId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        let s = JSON.parse(row.data);
        db.get("SELECT * FROM recipes WHERE id = ?", [recipeId], (err, r) => {
            s.dessert = {...r, ingredients: JSON.parse(r.ingredients)};
            if(!s.dessertPeople) s.dessertPeople = s.people;
            saveState(res, s);
        });
    });
});

// IMPORT/EXPORT
app.get('/api/export-json', checkAuth, (req, res) => {
    db.all("SELECT name, type, servings, ingredients, difficulty, procedure FROM recipes", [], (err, rows) => {
        const cleanData = rows.map(r => ({ ...r, ingredients: JSON.parse(r.ingredients) }));
        res.setHeader('Content-Disposition', 'attachment; filename=backup.json');
        res.json(cleanData);
    });
});

app.post('/api/import-json', checkAuth, (req, res) => {
    const recipes = req.body;
    if (!Array.isArray(recipes)) return res.status(400).json({ error: "JSON invalid" });
    const stmt = db.prepare(`INSERT INTO recipes (name, type, servings, ingredients, difficulty, procedure) VALUES (?, ?, ?, ?, ?, ?)`);
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        recipes.forEach(r => {
            stmt.run(r.name, r.type, r.servings || 2, JSON.stringify(r.ingredients), r.difficulty || 1, r.procedure || "");
        });
        db.run("COMMIT", () => {
            stmt.finalize();
            res.json({ message: "Import OK" });
        });
    });
});

app.listen(PORT, () => console.log(`Chef App su http://[${HOST}]:${PORT}`));