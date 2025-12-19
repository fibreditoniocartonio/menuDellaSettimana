const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

const SECRET_CODE = "0902"; // IL TUO CODICE DI ACCESSO
const DB_FILE = "recipes.db";

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
    // Tabella Ricette
    // Ingredienti salvati come stringa JSON per semplicità in SQLite
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

const checkAuth = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === `Bearer ${SECRET_CODE}`) {
        next();
    } else {
        res.status(401).json({ error: "Non autorizzato" });
    }
};

const toTitleCase = (str) => str.replace(/\b\w/g, l => l.toUpperCase());
const updateShoppingList = (list, name, qtyRaw, ratio) => {
    const key = name.trim().toLowerCase(); // Case insensitive
    const qtyNum = parseFloat(qtyRaw.toString().replace(',', '.')); // Tenta conversione numero
    
    if (!list[key]) list[key] = { total: 0, isQb: false };

    if (isNaN(qtyNum)) {
        // Se non è un numero (es. "q.b.", "quanto basta"), segna come q.b.
        list[key].isQb = true;
    } else {
        // Se è un numero, somma riproporzionato
        list[key].total += (qtyNum * ratio);
    }
};

app.post('/api/login', (req, res) => {
    const { code } = req.body;
    if (code === SECRET_CODE) {
        res.json({ token: SECRET_CODE, message: "Login OK" });
    } else {
        res.status(401).json({ error: "Codice errato" });
    }
});

app.get('/api/recipes', checkAuth, (req, res) => {
    db.all("SELECT * FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Parse ingredients JSON
        const recipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
        res.json(recipes);
    });
});

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

app.delete('/api/recipes/:id', checkAuth, (req, res) => {
    db.run(`DELETE FROM recipes WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Ricetta eliminata" });
    });
});

app.post('/api/generate-menu', checkAuth, (req, res) => {
    const { people } = req.body;
    
    db.all("SELECT * FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const recipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
        const primi = recipes.filter(r => r.type === 'primo');
        const secondi = recipes.filter(r => r.type === 'secondo');
        
        const weekMenu = [];
        const shoppingListRaw = {}; // Oggetto temporaneo { cipolla: { total: 100, isQb: false } }

        const getRandom = (arr) => arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null;

        for (let i = 0; i < 7; i++) {
            const dayMenu = { day: i + 1, lunch: null, dinner: null };
            // Alternanza (semplificata come prima)
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

        // Formatta lista spesa finale
        const shoppingList = {};
        Object.keys(shoppingListRaw).forEach(k => {
            const item = shoppingListRaw[k];
            // Usa toTitleCase per l'output. Se è qb scrivi "q.b.", altrimenti il numero arrotondato
            shoppingList[toTitleCase(k)] = item.isQb ? "q.b." : Math.ceil(item.total);
        });

        const stateData = { menu: weekMenu, shoppingList, dessert: null, people };
        
        // Salva nel DB (Upsert su id=1)
        db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(stateData)], (e) => {
            if (e) console.error(e);
            res.json(stateData);
        });
    });
});

// 1. GET LAST MENU
app.get('/api/last-menu', checkAuth, (req, res) => {
    db.get("SELECT data FROM menu_state WHERE id = 1", (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.json(null);
        res.json(JSON.parse(row.data));
    });
});

// 2. GENERATE DESSERT
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
                const key = toTitleCase(ing.name.trim().toLowerCase()); // Stessa formattazione output
                const qtyNum = parseFloat(ing.quantity.toString().replace(',', '.'));
                const isNewQb = isNaN(qtyNum);
                
                let currentVal = currentState.shoppingList[key];
                
                if (currentVal === undefined) {
                    currentState.shoppingList[key] = isNewQb ? "q.b." : Math.ceil(qtyNum * ratio);
                } else {
                    // Se esiste già
                    if (currentVal === "q.b." || isNewQb) {
                        currentState.shoppingList[key] = "q.b.";
                    } else {
                        // Sono entrambi numeri (assumiamo che currentVal sia numero se non è qb)
                        currentState.shoppingList[key] = parseInt(currentVal) + Math.ceil(qtyNum * ratio);
                    }
                }
            });

            // Salva nuovo stato
            db.run(`INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)`, [JSON.stringify(currentState)], () => {
                res.json(currentState);
            });
        });
    });
});

// 3. EXPORT CSV
app.get('/api/export-csv', checkAuth, (req, res) => {
    db.all("SELECT * FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).send("Error");
        
        // CSV Header: Name,Type,Servings,IngName,IngQty
        let csv = "Nome,Tipo,Porzioni,Ingrediente,Quantita\n";
        
        rows.forEach(r => {
            const ings = JSON.parse(r.ingredients);
            ings.forEach(ing => {
                csv += `"${r.name}","${r.type}",${r.servings},"${ing.name}","${ing.quantity}"\n`;
            });
        });
        
        res.header('Content-Type', 'text/csv');
        res.attachment('ricette.csv');
        res.send(csv);
    });
});

// 4. IMPORT CSV
app.post('/api/import-csv', checkAuth, (req, res) => {
    // Riceviamo testo grezzo
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
        const lines = body.split('\n').filter(l => l.trim().length > 0);
        const recipesMap = {}; // Raggruppa per nome ricetta

        // Salta header (riga 0)
        for (let i = 1; i < lines.length; i++) {
            // Parsing CSV rudimentale (gestisce virgolette semplici)
            const cols = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            if (!cols || cols.length < 5) continue;
            
            const clean = (s) => s.replace(/^"|"$/g, '').trim();
            const name = clean(cols[0]);
            const type = clean(cols[1]);
            const serv = parseInt(clean(cols[2]));
            const ingName = clean(cols[3]);
            const ingQty = clean(cols[4]);

            if (!recipesMap[name]) {
                recipesMap[name] = { name, type, servings: serv, ingredients: [] };
            }
            recipesMap[name].ingredients.push({ name: ingName, quantity: ingQty });
        }

        // Inserisci in DB
        const stmt = db.prepare(`INSERT INTO recipes (name, type, servings, ingredients) VALUES (?, ?, ?, ?)`);
        Object.values(recipesMap).forEach(r => {
            stmt.run(r.name, r.type, r.servings, JSON.stringify(r.ingredients));
        });
        stmt.finalize();
        
        res.json({ message: "Importazione completata" });
    });
});

app.listen(PORT, () => {
    console.log(`Server attivo su http://localhost:${PORT}`);
});