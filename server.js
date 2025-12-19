const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// --- CONFIGURAZIONE ---
const SECRET_CODE = "1234"; // IL TUO CODICE DI ACCESSO
const DB_FILE = "recipes.db";

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Setup
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
});

// --- MIDDLEWARE AUTH ---
const checkAuth = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === `Bearer ${SECRET_CODE}`) {
        next();
    } else {
        res.status(401).json({ error: "Non autorizzato" });
    }
};

// --- ROUTES ---

// Login
app.post('/api/login', (req, res) => {
    const { code } = req.body;
    if (code === SECRET_CODE) {
        res.json({ token: SECRET_CODE, message: "Login OK" });
    } else {
        res.status(401).json({ error: "Codice errato" });
    }
});

// Get All Recipes
app.get('/api/recipes', checkAuth, (req, res) => {
    db.all("SELECT * FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Parse ingredients JSON
        const recipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
        res.json(recipes);
    });
});

// Add Recipe
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

// Update Recipe
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

// Delete Recipe
app.delete('/api/recipes/:id', checkAuth, (req, res) => {
    db.run(`DELETE FROM recipes WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Ricetta eliminata" });
    });
});

// GENERATE MENU
app.post('/api/generate-menu', checkAuth, (req, res) => {
    const { people } = req.body; // Numero persone per il menu
    
    db.all("SELECT * FROM recipes", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const recipes = rows.map(r => ({...r, ingredients: JSON.parse(r.ingredients)}));
        const primi = recipes.filter(r => r.type === 'primo');
        const secondi = recipes.filter(r => r.type === 'secondo');
        
        // Logica semplice: 7 giorni, Pranzo e Cena.
        // Pranzo: Primo, Cena: Secondo (o viceversa, alternato)
        
        const weekMenu = [];
        const shoppingList = {};

        const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

        for (let i = 0; i < 7; i++) {
            const dayMenu = { day: i + 1, lunch: null, dinner: null };
            
            // Alternanza base: Giorni pari Primo a pranzo, Dispari Secondo a pranzo
            const lunchIsPrimo = (i % 2 === 0);
            
            if (lunchIsPrimo) {
                dayMenu.lunch = primi.length > 0 ? getRandom(primi) : null;
                dayMenu.dinner = secondi.length > 0 ? getRandom(secondi) : null;
            } else {
                dayMenu.lunch = secondi.length > 0 ? getRandom(secondi) : null;
                dayMenu.dinner = primi.length > 0 ? getRandom(primi) : null;
            }

            weekMenu.push(dayMenu);

            // Calcolo Lista Spesa
            [dayMenu.lunch, dayMenu.dinner].forEach(meal => {
                if (meal) {
                    const ratio = people / meal.servings; // Es: Ricetta x 2, voglio x 4 -> ratio 2
                    meal.ingredients.forEach(ing => {
                        const key = ing.name.toLowerCase().trim();
                        const qty = parseFloat(ing.quantity) * ratio;
                        if (!shoppingList[key]) shoppingList[key] = 0;
                        shoppingList[key] += qty;
                    });
                }
            });
        }

        res.json({ menu: weekMenu, shoppingList, targetPeople: people });
    });
});

app.listen(PORT, () => {
    console.log(`Server attivo su http://localhost:${PORT}`);
});