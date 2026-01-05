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

// INIZIALIZZAZIONE DB
db.serialize(() => {
    // Tabella Ricette
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        servings INTEGER,
        ingredients TEXT,
        difficulty INTEGER DEFAULT 1,
        procedure TEXT DEFAULT '',
        seasons TEXT DEFAULT '["inverno","primavera","estate","autunno"]'
    )`);

    // Tabella Stato Menu
    db.run(`CREATE TABLE IF NOT EXISTS menu_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
                                                   data TEXT
    )`);

    // Tabella Impostazioni (AI)
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
                                                 llm_api_url TEXT,
                                                 llm_api_key TEXT
    )`);

    // Migrazioni colonne (safe add)
    const addCol = (colSql) => {
        db.run(colSql, (err) => {});
    };
    addCol("ALTER TABLE recipes ADD COLUMN difficulty INTEGER DEFAULT 1");
    addCol("ALTER TABLE recipes ADD COLUMN procedure TEXT DEFAULT ''");
    addCol("ALTER TABLE recipes ADD COLUMN seasons TEXT DEFAULT '[\"inverno\",\"primavera\",\"estate\",\"autunno\"]'");
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

// Determina la stagione corrente
const getCurrentSeason = () => {
    const month = new Date().getMonth() + 1; // 1-12
    if (month >= 3 && month <= 5) return 'primavera';
    if (month >= 6 && month <= 8) return 'estate';
    if (month >= 9 && month <= 11) return 'autunno';
    return 'inverno';
};

// AI CATEGORIZATION HELPER
const categorizeWithLLM = async (shoppingListItems, settings) => {
    if (!settings || !settings.llm_api_key || !settings.llm_api_url) return null;

    const items = Object.keys(shoppingListItems);
    if (items.length === 0) return null;

    const prompt = `
    Sei un assistente per la lista della spesa. Categorizza questi articoli in base a in che reparto del supermercato li posso trovare: ${JSON.stringify(items)}.
    Rispondi ESCLUSIVAMENTE con un oggetto JSON valido.
    Esempio formato: { "Ortofrutta": ["Mele"], "Dispensa": ["Pasta"] }
    `;

    try {
        const response = await fetch(settings.llm_api_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.llm_api_key}`
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-120b",
                messages: [
                    { role: "system", content: "You are a helpful assistant that outputs JSON." },
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" },
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        let categorizedData;
        try {
            categorizedData = JSON.parse(content);
        } catch (e) {
            console.error("JSON AI non valido");
            return null;
        }

        // --- VALIDAZIONE DI SICUREZZA ---
        const returnedItemsSet = new Set(Object.values(categorizedData).flat());
        const missingItems = items.filter(originalItem => !returnedItemsSet.has(originalItem));
        if (missingItems.length > 0) {
            console.log("L'AI ha dimenticato dei pezzi, li recupero:", missingItems);
            if (!categorizedData["Altro"]) {
                categorizedData["Altro"] = [];
            }
            categorizedData["Altro"].push(...missingItems);
        }
        return categorizedData;

    } catch (e) {
        console.error("Errore AI Categorization:", e.message);
        return null;
    }
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
                procedure: live.procedure,
                seasons: live.seasons ? JSON.parse(live.seasons) : ["inverno","primavera","estate","autunno"]
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
// Modificato per accettare flag isManual
const updateShoppingItem = (list, name, qtyRaw, ratio, context, recipeName, isManual = false, extraId = null, manualCategory = null) => {
    const key = name.trim().toLowerCase();
    const qtyNum = parseFloat(qtyRaw.toString().replace(',', '.'));
    const calculatedQty = isNaN(qtyNum) ? 0 : (qtyNum * ratio);

    if (!list[key]) {
        list[key] = {
            total: 0,
            isQb: false,
            originalName: name,
            isManual: isManual, // Flag per identificare ingredienti manuali
            extraId: extraId,   // ID per l'eliminazione
            categoryHint: manualCategory, // Suggerimento categoria (se manuale)
            usages: []
        };
    } else {
        // Se esiste già, ereditiamo il flag manuale se presente (ma un ingrediente può essere sia manuale che ricetta)
        // Preferiamo mantenere isManual true solo se è SOLO manuale? No, permettiamo eliminazione se ha extraId.
        if (isManual) {
            list[key].isManual = true;
            list[key].extraId = extraId;
            if(manualCategory) list[key].categoryHint = manualCategory;
        }
    }

    list[key].usages.push({
        context: context,
        recipe: recipeName,
        qty: isNaN(qtyNum) ? "q.b." : calculatedQty
    });

    if (isNaN(qtyNum)) {
        list[key].isQb = true;
    } else {
        list[key].total += calculatedQty;
    }
};

const processRecipeForShopping = (recipeOrMeal, listCombinedRaw, people, contextLabel) => {
    if (!recipeOrMeal) return;

    if (recipeOrMeal.items && Array.isArray(recipeOrMeal.items)) {
        recipeOrMeal.items.forEach(subItem => {
            const itemPeople = recipeOrMeal.customServings || people;
            const ratio = itemPeople / (subItem.servings || 2);
            const ingredients = typeof subItem.ingredients === 'string' ? JSON.parse(subItem.ingredients) : subItem.ingredients;

            ingredients.forEach(ing => {
                updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, ratio, contextLabel, subItem.name);
            });
        });
    } else {
        const mealPeople = recipeOrMeal.customServings || people;
        const ratio = mealPeople / recipeOrMeal.servings;
        const ingredients = typeof recipeOrMeal.ingredients === 'string' ? JSON.parse(recipeOrMeal.ingredients) : recipeOrMeal.ingredients;

        ingredients.forEach(ing => {
            updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, ratio, contextLabel, recipeOrMeal.name);
        });
    }
};

async function calculateShoppingList(menu, dessert, extraMeals, people, dessertPeople, oldState = {}) {
    const oldMain = oldState.shoppingList ? (oldState.shoppingList.main || {}) : {};
    const overrides = oldState.shoppingOverrides || {};
    // Recuperiamo gli extra manuali salvati
    const manualExtras = oldState.shoppingExtras || [];

    const listCombinedRaw = {};

    // 1. Processo Ricette Menu
    menu.forEach(day => {
        ['lunch', 'dinner'].forEach(slot => {
            const context = `Giorno ${day.day} (${slot === 'lunch' ? 'Pranzo' : 'Cena'})`;
            processRecipeForShopping(day[slot], listCombinedRaw, people, context);
        });
    });

    // 2. Processo Pasti Extra (Ricette complete aggiunte a mano)
    if (extraMeals && Array.isArray(extraMeals)) {
        extraMeals.forEach(meal => {
            processRecipeForShopping(meal, listCombinedRaw, meal.customServings || people, "Extra");
        });
    }

    // 3. Processo Dolce
    if(dessert) {
        const dRatio = (dessertPeople || people) / dessert.servings;
        const ingredients = typeof dessert.ingredients === 'string' ? JSON.parse(dessert.ingredients) : dessert.ingredients;
        ingredients.forEach(ing => {
            updateShoppingItem(listCombinedRaw, ing.name, ing.quantity, dRatio, "Dolce", dessert.name);
        });
    }

    // 4. MERGE DEGLI EXTRA MANUALI NELLA LISTA PRINCIPALE
    // Qui soddisfiamo la richiesta di "non fare l'area a parte"
    if (manualExtras && Array.isArray(manualExtras)) {
        manualExtras.forEach(item => {
            // updateShoppingItem gestisce la somma se esiste già
            updateShoppingItem(
                listCombinedRaw,
                item.name,
                item.qty,
                1,
                "Manuale",
                "Aggiunto a mano",
                true, // isManual
                item.id, // ID univoco per cancellazione
                item.category // Passiamo la categoria se c'è
            );
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
                isModified: hasOverride,
                isManual: item.isManual, // Passiamo info al frontend
                extraId: item.extraId,   // Passiamo ID al frontend
                categoryHint: item.categoryHint,
                usages: item.usages
            };
        });
        return finalObj;
    };

    const mainList = formatList(listCombinedRaw, oldMain, 'main');

    // Gestione Categorie
    let categories = null;

    // Se ci sono categorie vecchie, cerchiamo di preservarle o aggiornarle con i nuovi manuali
    if (oldState.shoppingList && oldState.shoppingList.categories) {
        categories = oldState.shoppingList.categories;

        // Se un item manuale ha una categoria specificata ed è nuovo, aggiungiamolo
        Object.keys(mainList).forEach(itemName => {
            const item = mainList[itemName];
            if (item.isManual && item.categoryHint) {
                // Rimuovi da altre categorie se presente (spostamento)
                Object.keys(categories).forEach(c => {
                    if(categories[c].includes(itemName)) {
                        // Non facciamo nulla se è già lì, altrimenti rimuoviamo?
                        // Per semplicità: l'ultima categoria vince se specificata manualmente
                    }
                });

                if (!categories[item.categoryHint]) categories[item.categoryHint] = [];
                if (!categories[item.categoryHint].includes(itemName)) {
                    categories[item.categoryHint].push(itemName);
                }
            }
        });
    }

    // Se non ci sono categorie (prima volta), proviamo AI
    // Nota: L'AI viene chiamata solo alla generazione del menu o se forzato,
    // qui manteniamo le categorie esistenti per velocità negli update parziali.
    const settings = await new Promise(resolve => {
        db.get("SELECT * FROM settings WHERE id = 1", (err, row) => resolve(row));
    });

    if (!categories && settings && settings.llm_api_key) {
        const aiGroups = await categorizeWithLLM(mainList, settings);
        if (aiGroups) {
            categories = aiGroups;
        }
    }

    // Se le categorie sono attive (generate ora da IA o ereditate)
    if (categories && Object.keys(categories).length > 0) {
        // Creiamo un Set di tutti gli item già categorizzati per ricerca veloce
        const categorizedItems = new Set(Object.values(categories).flat());

        Object.keys(mainList).forEach(itemName => {
            const item = mainList[itemName];

            // Se è un item MANUALE e NON si trova in nessuna categoria
            if (item.isManual && !categorizedItems.has(itemName)) {
                // Assicuriamoci che esista la categoria "Altro"
                if (!categories["Altro"]) categories["Altro"] = [];

                // Aggiungiamolo se non c'è già
                if (!categories["Altro"].includes(itemName)) {
                    categories["Altro"].push(itemName);
                }

                // Aggiorniamo anche l'hint nell'item per coerenza futura
                item.categoryHint = "Altro";

                // Aggiorniamo anche l'array raw manualExtras per persistenza nel DB
                // (così al prossimo giro ha già la categoria salvata)
                const rawExtra = manualExtras.find(e => toTitleCase(e.name) === itemName);
                if (rawExtra) rawExtra.category = "Altro";
            }
        });
    }

    return {
        shoppingList: { main: mainList, categories: categories },
        shoppingOverrides: overrides,
        shoppingExtras: manualExtras // Manteniamo l'array raw per poterlo salvare nel DB
    };
}

// --- ROTTE PUBLIC ---
app.get('/api/background/:theme', (req, res) => {
    const theme = req.params.theme;
    const bgDir = path.join(__dirname, 'public', 'bg');

    fs.readdir(bgDir, (err, files) => {
        if (err) {
            console.error("Errore lettura cartella bg:", err);
            return res.json({ filename: null });
        }
        const candidates = files.filter(f =>
        (f.startsWith(theme + '.') || f === theme + '.png') &&
        /\.(png|jpg|jpeg|webp)$/i.test(f)
        );
        if (candidates.length > 0) {
            const picked = candidates[Math.floor(Math.random() * candidates.length)];
            res.json({ filename: picked });
        } else {
            res.json({ filename: null });
        }
    });
});

app.post('/api/login', (req, res) => {
    const { code } = req.body;
    if (code === SECRET_CODE) res.json({ token: SECRET_CODE });
    else res.status(401).json({ error: "Codice errato" });
});

// --- ROTTE IMPOSTAZIONI ---
app.get('/api/settings', checkAuth, (req, res) => {
    db.get("SELECT llm_api_url, llm_api_key FROM settings WHERE id = 1", (err, row) => {
        if (err) return res.status(500).json({});
        res.json(row || { llm_api_url: '', llm_api_key: '' });
    });
});

app.post('/api/settings', checkAuth, (req, res) => {
    const { llm_api_url, llm_api_key } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (id, llm_api_url, llm_api_key) VALUES (1, ?, ?)`,
           [llm_api_url, llm_api_key],
           (err) => {
               if (err) return res.status(500).json({ error: err.message });
               res.json({ success: true });
           }
    );
});

// --- ROTTE RICETTE ---
app.get('/api/recipes', checkAuth, (req, res) => {
    db.all("SELECT * FROM recipes ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const recipes = rows.map(r => ({
            ...r,
            ingredients: JSON.parse(r.ingredients),
                                       seasons: r.seasons ? JSON.parse(r.seasons) : ["inverno","primavera","estate","autunno"]
        }));
        res.json(recipes);
    });
});

app.post('/api/recipes', checkAuth, (req, res) => {
    const { name, type, servings, ingredients, difficulty, procedure, seasons } = req.body;
    const seasonJson = JSON.stringify(seasons || ["inverno","primavera","estate","autunno"]);

    db.run(`INSERT INTO recipes (name, type, servings, ingredients, difficulty, procedure, seasons) VALUES (?, ?, ?, ?, ?, ?, ?)`,
           [name, type, servings, JSON.stringify(ingredients), difficulty || 1, procedure || "", seasonJson],
           function(err) {
               if (err) return res.status(500).json({ error: err.message });
               res.json({ id: this.lastID });
           }
    );
});

app.put('/api/recipes/:id', checkAuth, (req, res) => {
    const { name, type, servings, ingredients, difficulty, procedure, seasons } = req.body;
    const seasonJson = JSON.stringify(seasons || ["inverno","primavera","estate","autunno"]);

    db.run(`UPDATE recipes SET name = ?, type = ?, servings = ?, ingredients = ?, difficulty = ?, procedure = ?, seasons = ? WHERE id = ?`,
           [name, type, servings, JSON.stringify(ingredients), difficulty || 1, procedure || "", seasonJson, req.params.id],
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
    const currentSeason = getCurrentSeason();

    db.get("SELECT data FROM menu_state WHERE id = 1", (errState, rowState) => {
        let preservedExtras = [];
        if (!errState && rowState && rowState.data) {
            try {
                const oldData = JSON.parse(rowState.data);
                if (oldData.shoppingExtras) {
                    preservedExtras = oldData.shoppingExtras.filter(e => !e.checked);
                }
            } catch (e) {}
        }

        db.all("SELECT * FROM recipes", [], async (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            // FILTRO STAGIONALE
            const allRecipes = rows.map(r => ({
                ...r,
                ingredients: JSON.parse(r.ingredients),
                                              seasons: r.seasons ? JSON.parse(r.seasons) : ["inverno","primavera","estate","autunno"]
            })).filter(r => r.seasons.includes(currentSeason));

            if (allRecipes.length < 2) return res.status(400).json({ error: `Poche ricette per la stagione corrente (${currentSeason})!` });

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

            // Calcolo lista spesa (include chiamata AI)
            const calculated = await calculateShoppingList(weekMenu, selectedDessert, extraMeals, people, dessertPeople, tempState);

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
const saveState = async (res, newState) => {
    const recalculated = await calculateShoppingList(
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
    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        // Ora tutti gli item sono in shoppingList.main, indipendentemente da isExtra
        // isExtra (o meglio isManual) è solo un flag.
        if (s.shoppingList.main[item]) s.shoppingList.main[item].checked = !s.shoppingList.main[item].checked;

        // Se è un manual extra, dobbiamo aggiornare anche lo stato in shoppingExtras per persistenza
        // Cerchiamo nell'array raw
        if (s.shoppingExtras) {
            const extraRaw = s.shoppingExtras.find(x => x.name.toLowerCase() === item.toLowerCase());
            if (extraRaw) extraRaw.checked = s.shoppingList.main[item].checked;
        }

        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(s)], () => {
            res.json({ success: true });
        });
    });
});

app.post('/api/update-shopping-qty', checkAuth, (req, res) => {
    const { category, item, newQty } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        if (!s.shoppingOverrides) s.shoppingOverrides = {};
        s.shoppingOverrides[`main_${item}`] = newQty;

        // Se è un manual item, aggiorniamo anche la quantità base nel DB per futuri ricalcoli
        if (s.shoppingExtras) {
            const extraRaw = s.shoppingExtras.find(x => toTitleCase(x.name) === item);
            if (extraRaw) extraRaw.qty = newQty;
        }

        await saveState(res, s);
    });
});

// Endpoint Aggiorna categoria
app.post('/api/update-shopping-category', checkAuth, (req, res) => {
    const { item, newCategory } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);

        if (!s.shoppingList.categories) s.shoppingList.categories = {};
        let cats = s.shoppingList.categories;

        // Rimuove l'item dalla vecchia categoria
        Object.keys(cats).forEach(c => {
            if (Array.isArray(cats[c])) {
                cats[c] = cats[c].filter(i => i !== item);
                if (cats[c].length === 0) delete cats[c];
            }
        });

        // Aggiunge alla nuova
        if (!cats[newCategory]) cats[newCategory] = [];
        if (!cats[newCategory].includes(item)) {
            cats[newCategory].push(item);
        }

        // Se è un manual item, salviamo la categoria nell'oggetto extra per persistenza
        if (s.shoppingExtras) {
            const extraRaw = s.shoppingExtras.find(x => toTitleCase(x.name) === item);
            if (extraRaw) extraRaw.category = newCategory;
        }

        s.shoppingList.categories = cats;

        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(s)], () => {
            res.json(s);
        });
    });
});

app.post('/api/add-shopping-extra', checkAuth, (req, res) => {
    const { name, qty, category } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        if (!s.shoppingExtras) s.shoppingExtras = [];

        const newExtra = {
            id: Date.now(),
           name: toTitleCase(name),
           qty,
           checked: false,
           category: category
        };

        s.shoppingExtras.push(newExtra);
        await saveState(res, s);
    });
});

app.post('/api/delete-manual-shopping-item', checkAuth, (req, res) => {
    let { extraId, name } = req.body;

    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);

        // 1. Rimuovi da shoppingExtras
        if (s.shoppingExtras) {
            if (extraId) {
                // Se abbiamo l'ID, troviamo il nome prima di cancellare (serve per pulire le categorie)
                const target = s.shoppingExtras.find(e => e.id == extraId);
                if (target) name = target.name;

                s.shoppingExtras = s.shoppingExtras.filter(e => e.id != extraId);
            } else if (name) {
                // Fallback eliminazione per nome
                s.shoppingExtras = s.shoppingExtras.filter(e => e.name.toLowerCase() !== name.toLowerCase());
            }
        }

        // 2. Rimuovi eventuali override associati
        if (name && s.shoppingOverrides) {
            const key = `main_${toTitleCase(name)}`;
            if(s.shoppingOverrides[key]) delete s.shoppingOverrides[key];
        }

        // Se l'ingrediente era in una categoria e questa diventa vuota, eliminiamo la categoria.
        if (name && s.shoppingList && s.shoppingList.categories) {
            const cats = s.shoppingList.categories;
            Object.keys(cats).forEach(c => {
                if (Array.isArray(cats[c])) {
                    // Filtra via l'ingrediente eliminato (case insensitive per sicurezza)
                    cats[c] = cats[c].filter(i => i.toLowerCase() !== name.toLowerCase());
                    // Se la categoria ora è vuota, eliminala
                    if (cats[c].length === 0) delete cats[c];
                }
            });
            s.shoppingList.categories = cats;
        }

        await saveState(res, s);
    });
});

app.post('/api/clear-shopping-extras', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
        if (!row) return res.status(400).json({ error: "No menu" });
        let s = JSON.parse(row.data);
        s.shoppingExtras = [];
        await saveState(res, s);
    });
});

// --- UPDATES MENU ---
app.post('/api/update-meal-servings', checkAuth, (req, res) => {
    const { day, type, servings, extraId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
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
        await saveState(res, s);
    });
});

app.post('/api/regenerate-meal', checkAuth, (req, res) => {
    const { day, type } = req.body;
    const currentSeason = getCurrentSeason();

    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);

        db.all("SELECT * FROM recipes", [], async (dberr, rows) => {
            // Filtra per stagione anche qui
            const allRecipes = rows.map(r => ({
                ...r,
                ingredients: JSON.parse(r.ingredients),
                                              seasons: r.seasons ? JSON.parse(r.seasons) : ["inverno","primavera","estate","autunno"]
            })).filter(r => r.seasons.includes(currentSeason));

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
            await saveState(res, s);
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
        db.all(`SELECT * FROM recipes WHERE id IN (${placeholders})`, fetchIds, async (err, dbRows) => {
            if(!dbRows || dbRows.length === 0) return res.status(400).json({error: "No Recipe"});

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
            await saveState(res, s);
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
        db.all(`SELECT * FROM recipes WHERE id IN (${placeholders})`, fetchIds, async (err, dbRows) => {
            if(!dbRows || dbRows.length === 0) return res.status(400).json({error: "No Recipe"});

            const r1 = dbRows.find(r => r.id == recipeId);
            const r2 = pairedRecipeId ? dbRows.find(r => r.id == pairedRecipeId) : null;

            const newMeal = buildMealObject(r1, r2);
            newMeal.uniqueId = Date.now();
            newMeal.customServings = s.people;

            s.extraMeals.push(newMeal);
            await saveState(res, s);
        });
    });
});

app.post('/api/remove-manual-meal', checkAuth, (req, res) => {
    const { uniqueId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
        if (!row) return res.status(400).json({ error: "Err" });
        let s = JSON.parse(row.data);
        if (s.extraMeals) {
            s.extraMeals = s.extraMeals.filter(m => m.uniqueId != uniqueId);
        }
        await saveState(res, s);
    });
});

// --- DOLCE ---
app.post('/api/regenerate-dessert', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        let s = JSON.parse(row.data);
        db.all("SELECT * FROM recipes WHERE type = 'dolce'", [], async (err, rows) => {
            const all = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
            const pool = s.dessert ? all.filter(r => r.id !== s.dessert.id) : all;
            s.dessert = getWeightedRandom(pool, new Set());
            if(!s.dessertPeople) s.dessertPeople = s.people;
            await saveState(res, s);
        });
    });
});

app.post('/api/update-dessert-servings', checkAuth, (req, res) => {
    const { servings } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", async (err, row) => {
        let s = JSON.parse(row.data);
        s.dessertPeople = parseInt(servings);
        await saveState(res, s);
    });
});

app.post('/api/set-manual-dessert', checkAuth, (req, res) => {
    const { recipeId } = req.body;
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        let s = JSON.parse(row.data);
        db.get("SELECT * FROM recipes WHERE id = ?", [recipeId], async (err, r) => {
            s.dessert = {...r, ingredients: JSON.parse(r.ingredients)};
            if(!s.dessertPeople) s.dessertPeople = s.people;
            await saveState(res, s);
        });
    });
});

// IMPORT/EXPORT
app.post('/api/export-json', checkAuth, (req, res) => {
    const { ids } = req.body;
    let sql = "SELECT name, type, servings, ingredients, difficulty, procedure, seasons FROM recipes";
    let params = [];

    if (ids && Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        sql += ` WHERE id IN (${placeholders})`;
        params = ids;
    }

    db.all(sql, params, (err, rows) => {
        if(err) return res.status(500).json({ error: err.message });
        const cleanData = rows.map(r => ({
            ...r,
            ingredients: JSON.parse(r.ingredients),
                                         seasons: r.seasons ? JSON.parse(r.seasons) : ["inverno","primavera","estate","autunno"]
        }));
        const jsonStr = JSON.stringify(cleanData, null, 4);
        res.setHeader('Content-Disposition', 'attachment; filename=backup.json');
        res.setHeader('Content-Type', 'application/json');
        res.send(jsonStr);
    });
});

app.post('/api/import-json', checkAuth, (req, res) => {
    const { recipes, clear } = req.body;
    if (!Array.isArray(recipes)) return res.status(400).json({ error: "JSON invalid" });

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        if (clear) {
            db.run("DELETE FROM recipes");
            db.run("DELETE FROM sqlite_sequence WHERE name='recipes'");
        }

        const stmt = db.prepare(`INSERT INTO recipes (name, type, servings, ingredients, difficulty, procedure, seasons) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        recipes.forEach(r => {
            const seasons = r.seasons ? JSON.stringify(r.seasons) : '["inverno","primavera","estate","autunno"]';
            stmt.run(r.name, r.type, r.servings || 2, JSON.stringify(r.ingredients), r.difficulty || 1, r.procedure || "", seasons);
        });

        db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: "Errore durante import" });
            stmt.finalize();
            res.json({ message: "Import OK", count: recipes.length });
        });
    });
});

app.listen(PORT, () => console.log(`Chef App su http://[${HOST}]:${PORT}`));
