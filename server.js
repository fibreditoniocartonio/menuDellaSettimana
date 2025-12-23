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

const getWeightedRandom = (items, usedIds) => {
    let pool = items.filter(r => !usedIds.has(r.id));
    if (pool.length === 0) pool = items; 
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

// --- LOGICA AGGIORNAMENTO DATI (HYDRATION) ---
const hydrateMenuWithLiveRecipes = (menuState, allRecipes) => {
    if (!menuState) return null;
    const recipeMap = new Map(allRecipes.map(r => [r.id, r]));

    const refreshItem = (item) => {
        if (!item) return item;
        if (item.items && Array.isArray(item.items)) {
            item.items = item.items.map(sub => refreshItem(sub));
            return item; 
        }
        if (item.id && recipeMap.has(item.id)) {
            const live = recipeMap.get(item.id);
            return {
                ...item,
                name: live.name,
                type: live.type,
                servings: live.servings, 
                ingredients: JSON.parse(live.ingredients),
                difficulty: live.difficulty,
                procedure: live.procedure
            };
        }
        return item;
    };

    if (menuState.menu) {
        menuState.menu.forEach(day => {
            day.lunch = refreshItem(day.lunch);
            day.dinner = refreshItem(day.dinner);
        });
    }
    if (menuState.extraMeals) {
        menuState.extraMeals = menuState.extraMeals.map(m => refreshItem(m));
    }
    if (menuState.dessert) {
        menuState.dessert = refreshItem(menuState.dessert);
    }
    return menuState;
};

// --- LOGICA LISTA DELLA SPESA ---
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

const processRecipeForShopping = (recipeOrMeal, listCombinedRaw, people) => {
    if (!recipeOrMeal) return;

    if (recipeOrMeal.items && Array.isArray(recipeOrMeal.items)) {
        recipeOrMeal.items.forEach(subItem => {
            const itemPeople = recipeOrMeal.customServings || people;
            const ratio = itemPeople / (subItem.servings || 2); 
            const ingredients = typeof subItem.ingredients === 'string' ? JSON.parse(subItem.ingredients) : subItem.ingredients;
            
            ingredients.forEach(ing => {
                updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, ratio);
            });
        });
    } else {
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
    const extras = oldState.shoppingExtras || []; 

    const listCombinedRaw = {};

    menu.forEach(day => {
        ['lunch', 'dinner'].forEach(slot => {
            processRecipeForShopping(day[slot], listCombinedRaw, people);
        });
    });

    if (extraMeals && Array.isArray(extraMeals)) {
        extraMeals.forEach(meal => {
            processRecipeForShopping(meal, listCombinedRaw, meal.customServings || people);
        });
    }

    if(dessert) {
        const dRatio = (dessertPeople || people) / dessert.servings;
        const ingredients = typeof dessert.ingredients === 'string' ? JSON.parse(dessert.ingredients) : dessert.ingredients;
        ingredients.forEach(ing => {
            updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, dRatio);
        });
    }

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
        shoppingList: { main: formatList(listCombinedRaw, oldMain, 'main') },
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
        if (!errState && rowState && rowState.data) {
            try {
                const oldData = JSON.parse(rowState.data);
                if (oldData.shoppingExtras) preservedExtras = [...oldData.shoppingExtras];
            } catch (e) {}
        }

        db.all("SELECT * FROM recipes", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            if (rows.length < 2) return res.status(400).json({ error: "Poche ricette nel DB!" });
            
            const allRecipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            
            const primiSemplici = allRecipes.filter(r => r.type === 'primo');
            const primiCompleti = allRecipes.filter(r => r.type === 'primo_completo');
            const sughi = allRecipes.filter(r => r.type === 'sugo');
            
            const secondi = allRecipes.filter(r => r.type === 'secondo');
            const contorni = allRecipes.filter(r => r.type === 'contorno');
            const secondiCompleti = allRecipes.filter(r => r.type === 'secondo_completo');
            
            const dolci = allRecipes.filter(r => r.type === 'dolce');

            const weekMenu = [];
            const usedIds = new Set(); 

            for (let i = 0; i < 7; i++) {
                const dayMenu = { day: i + 1, lunch: null, dinner: null };
                
                // --- PRANZO ---
                const useCompleteLunch = (Math.random() > 0.6 && primiCompleti.length > 0) || (primiSemplici.length === 0);
                if (useCompleteLunch) {
                    dayMenu.lunch = getWeightedRandom(primiCompleti, usedIds);
                } else {
                    const p = getWeightedRandom(primiSemplici, usedIds);
                    const s = getWeightedRandom(sughi, usedIds);
                    if (p) {
                        if (s) {
                             dayMenu.lunch = {
                                isComposite: true,
                                name: `${p.name} al ${s.name}`, 
                                items: [p, s],
                                difficulty: Math.max(p.difficulty, s.difficulty)
                            };
                        } else {
                            dayMenu.lunch = p;
                        }
                    }
                }

                // --- CENA ---
                const useCompleteDinner = (Math.random() > 0.5 && secondiCompleti.length > 0) || (secondi.length === 0);
                if (useCompleteDinner && secondiCompleti.length > 0) {
                    dayMenu.dinner = getWeightedRandom(secondiCompleti, usedIds);
                } else {
                    const sec = getWeightedRandom(secondi, usedIds);
                    const cont = getWeightedRandom(contorni, usedIds); 
                    if (sec) {
                        if (cont) {
                            dayMenu.dinner = {
                                isComposite: true,
                                name: `${sec.name} + ${cont.name}`,
                                items: [sec, cont],
                                difficulty: Math.max(sec.difficulty, cont.difficulty)
                            };
                        } else {
                            dayMenu.dinner = sec;
                        }
                    } else {
                        dayMenu.dinner = null;
                    }
                }
                weekMenu.push(dayMenu);
            }

            const selectedDessert = getWeightedRandom(dolci, new Set()); 
            const dessertPeople = people;
            const extraMeals = []; 

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
        if (!row || !row.data) return res.json(null);
        let storedMenu = JSON.parse(row.data);
        db.all("SELECT * FROM recipes", [], (errRx, rowsRx) => {
            if (!errRx && rowsRx) {
                storedMenu = hydrateMenuWithLiveRecipes(storedMenu, rowsRx);
            }
            res.json(storedMenu);
        });
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
        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(s)], () => {
             res.json({ success: true });
        });
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
    const { day, type, servings, extraId } = req.body; 
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
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        
        db.all("SELECT * FROM recipes", [], (dberr, rows) => {
            const allRecipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            
            if (type === 'lunch') {
                const primiSemplici = allRecipes.filter(r => r.type === 'primo');
                const primiCompleti = allRecipes.filter(r => r.type === 'primo_completo');
                const sughi = allRecipes.filter(r => r.type === 'sugo');

                const useComplete = (Math.random() > 0.6 && primiCompleti.length > 0) || (primiSemplici.length === 0);
                let newMeal = null;

                if (useComplete) {
                    newMeal = getWeightedRandom(primiCompleti, new Set());
                } else {
                    const p = getWeightedRandom(primiSemplici, new Set());
                    const sg = getWeightedRandom(sughi, new Set());
                    if (p) {
                         if (sg) {
                            newMeal = { isComposite: true, name: `${p.name} al ${sg.name}`, items: [p, sg], difficulty: Math.max(p.difficulty, sg.difficulty)};
                         } else {
                            newMeal = p;
                         }
                    }
                }
                
                if (newMeal) {
                     if(s.menu[day-1].lunch && s.menu[day-1].lunch.customServings) {
                        newMeal.customServings = s.menu[day-1].lunch.customServings;
                     }
                     s.menu[day-1].lunch = newMeal;
                }

            } else if (type === 'dinner') {
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

// Helper per creare oggetto pasto da 1 o 2 ricette
const buildMealObject = (r1, r2 = null) => {
    const parsedR1 = {...r1, ingredients: JSON.parse(r1.ingredients)};
    if (!r2) return parsedR1;

    const parsedR2 = {...r2, ingredients: JSON.parse(r2.ingredients)};
    
    // Ordine standard: Primo prima di Sugo, Secondo prima di Contorno
    let items = [parsedR1, parsedR2];
    if (parsedR1.type === 'sugo' || parsedR1.type === 'contorno') {
        items = [parsedR2, parsedR1];
    }

    let name = `${items[0].name} + ${items[1].name}`;
    if (items[0].type.includes('primo') && items[1].type === 'sugo') {
        name = `${items[0].name} al ${items[1].name}`;
    }

    return {
        isComposite: true,
        name: name,
        items: items,
        difficulty: Math.max(r1.difficulty, r2.difficulty)
    };
};

app.post('/api/set-manual-meal', checkAuth, (req, res) => {
    const { day, type, recipeId, pairedRecipeId, extraId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        
        const fetchIds = [recipeId];
        if (pairedRecipeId) fetchIds.push(pairedRecipeId);

        const placeholders = fetchIds.map(() => '?').join(',');
        db.all(`SELECT * FROM recipes WHERE id IN (${placeholders})`, fetchIds, (err, dbRows) => {
            if(!dbRows || dbRows.length === 0) return res.status(400).json({error: "No Recipe"});
            
            // Trova le ricette corrispondenti
            const r1 = dbRows.find(r => r.id == recipeId);
            const r2 = pairedRecipeId ? dbRows.find(r => r.id == pairedRecipeId) : null;

            if(!r1) return res.status(400).json({error: "Main recipe not found"});

            const newMeal = buildMealObject(r1, r2);

            if (extraId) {
                const idx = s.extraMeals.findIndex(e => e.uniqueId == extraId);
                if (idx >= 0) {
                    newMeal.uniqueId = extraId;
                    newMeal.customServings = s.extraMeals[idx].customServings;
                    s.extraMeals[idx] = newMeal;
                }
            } else {
                const old = s.menu[day-1][type];
                if(old && old.customServings) newMeal.customServings = old.customServings;
                s.menu[day-1][type] = newMeal;
            }
            saveState(res, s);
        });
    });
});

app.post('/api/add-manual-meal', checkAuth, (req, res) => {
    const { recipeId, pairedRecipeId } = req.body; 
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        if (!s.extraMeals) s.extraMeals = [];

        const fetchIds = [recipeId];
        if (pairedRecipeId) fetchIds.push(pairedRecipeId);

        const placeholders = fetchIds.map(() => '?').join(',');
        db.all(`SELECT * FROM recipes WHERE id IN (${placeholders})`, fetchIds, (err, dbRows) => {
             if(!dbRows || dbRows.length === 0) return res.status(400).json({error: "No Recipe"});
            
            const r1 = dbRows.find(r => r.id == recipeId);
            const r2 = pairedRecipeId ? dbRows.find(r => r.id == pairedRecipeId) : null;

            const newMeal = buildMealObject(r1, r2);
            newMeal.uniqueId = Date.now(); 
            newMeal.customServings = s.people; 

            s.extraMeals.push(newMeal);
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