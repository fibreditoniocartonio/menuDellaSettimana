const API_URL = '/api';
let authToken = localStorage.getItem('familyMenuToken');
let recipesCache = [];
let contextSelection = null; 
let shoppingViewMode = 'cumulative'; // 'cumulative' | 'recipe'

// INIT
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(); // Applica il tema in base alla data
    if (authToken) {
        showView('view-dashboard');
        document.getElementById('navbar').classList.remove('hidden');
    } else {
        showView('view-login');
    }
});

// --- THEMING SYSTEM ---
function applyTheme() {
    const savedTheme = localStorage.getItem('familyMenuTheme') || 'auto';
    const body = document.body;
    body.className = ''; // Reset

    // Se l'utente ha forzato un tema, usalo ed esci
    if (savedTheme !== 'auto') {
        body.classList.add(savedTheme);
        return;
    }

    // Altrimenti: Logica Automatica Stagionale
    const today = new Date();
    const m = today.getMonth() + 1; // 1-12
    const d = today.getDate();

    if (m === 12 || (m === 1 && d <= 6)) {
        body.classList.add('theme-christmas');
    } else if (m === 10 && d >= 20) {
        body.classList.add('theme-halloween');
    } else if (m === 2 && d <= 14) {
        body.classList.add('theme-valentine');
    } else if (m >= 3 && m <= 5) {
        body.classList.add('theme-spring');
    } else if (m >= 6 && m <= 8) {
        body.classList.add('theme-summer');
    } else if (m >= 9 && m <= 11) {
        body.classList.add('theme-autumn');
    } else {
        body.classList.add('theme-winter');
    }
}
function changeTheme(val) {
    localStorage.setItem('familyMenuTheme', val);
    applyTheme();
}

// --- CUSTOM ALERTS & CONFIRMS ---
function showCustomDialog(title, message, type = 'alert', defaultValue = '') {
    return new Promise((resolve) => {
        const container = document.getElementById('custom-dialog-container');
        let inputField = '';
        
        if (type === 'prompt') {
            inputField = `<input type="text" id="dialog-input" value="${defaultValue}" class="full-width" style="margin-top:10px;">`;
        }

        container.innerHTML = `
            <div class="custom-dialog-overlay">
                <div class="custom-dialog-box">
                    <h3>${title}</h3>
                    <p>${message}</p>
                    ${inputField}
                    <div class="dialog-buttons">
                        ${type !== 'alert' ? `<button class="btn-secondary" id="dialog-cancel">Annulla</button>` : ''}
                        <button class="btn-primary" id="dialog-ok">OK</button>
                    </div>
                </div>
            </div>
        `;

        const okBtn = document.getElementById('dialog-ok');
        const cancelBtn = document.getElementById('dialog-cancel');
        const input = document.getElementById('dialog-input');

        if(input) input.focus();

        const close = (result) => {
            container.innerHTML = '';
            resolve(result);
        };

        okBtn.onclick = () => {
            if (type === 'prompt') close(input.value);
            else close(true);
        };
        
        if (cancelBtn) cancelBtn.onclick = () => close(false);
    });
}

async function showAlert(message) { await showCustomDialog("Avviso", message, 'alert'); }
async function showConfirm(message) { return await showCustomDialog("Conferma", message, 'confirm'); }
async function showPrompt(message, val = '') { return await showCustomDialog("Inserisci", message, 'prompt', val); }

// --- NAVIGATION SYSTEM ---
function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    
    const target = document.getElementById(viewId);
    target.classList.remove('hidden');
    setTimeout(() => target.classList.add('active'), 10);

    const titles = {
        'view-dashboard': 'Dashboard',
        'view-recipes': 'Ricettario',
        'view-menu': 'Menu & Spesa'
    };
    const titleEl = document.getElementById('nav-title');
    if(titleEl && titles[viewId]) titleEl.innerText = titles[viewId];
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const btns = document.querySelectorAll('.tab-btn');
    if(tabId === 'tab-menu') btns[0].classList.add('active');
    else btns[1].classList.add('active');

    document.getElementById(tabId).classList.add('active');
}

// --- AUTH ---
async function login() {
    const code = document.getElementById('access-code').value;
    const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });

    if (res.ok) {
        const data = await res.json();
        authToken = `Bearer ${data.token}`;
        localStorage.setItem('familyMenuToken', authToken);
        document.getElementById('navbar').classList.remove('hidden');
        showView('view-dashboard');
    } else {
        document.getElementById('login-error').innerText = "Codice errato";
    }
}

function logout() {
    localStorage.removeItem('familyMenuToken');
    authToken = null;
    location.reload();
}

// --- API WRAPPER ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = { 'Authorization': authToken };
    if (body) headers['Content-Type'] = 'application/json';
    
    const res = await fetch(`${API_URL}${endpoint}`, {
        method, headers,
        body: body ? JSON.stringify(body) : null
    });
    
    if (res.status === 401) logout();
    return res; 
}

// --- RICETTE ---
async function loadRecipes() {
    showView('view-recipes');
    const res = await apiCall('/recipes');
    recipesCache = await res.json();
    renderRecipeList(recipesCache);
}

function renderRecipeList(list) {
    const container = document.getElementById('recipes-list');
    container.innerHTML = '';

    const groups = {
        'primo': { title: '🍝 Primi', items: [] },
        'secondo': { title: '🥩 Secondi', items: [] },
        'dolce': { title: '🍰 Dolci', items: [] }
    };

    list.forEach(r => {
        if(groups[r.type]) groups[r.type].items.push(r);
    });

    Object.keys(groups).forEach(type => {
        const group = groups[type];
        if (group.items.length > 0) {
            const header = document.createElement('div');
            header.className = 'recipe-group-header';
            header.innerText = group.title;
            container.appendChild(header);

            group.items.forEach(r => {
                const diffStars = "⭐".repeat(r.difficulty || 1);
                const div = document.createElement('div');
                div.className = 'recipe-card';
                div.onclick = () => openRecipeModal(r);
                div.innerHTML = `
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:bold">${r.name}</span>
                        <span style="font-size:0.75rem; color:#888;">${diffStars}</span>
                    </div>
                    <span>${r.servings}p</span>
                `;
                container.appendChild(div);
            });
        }
    });
}

function filterRecipes() {
    const query = document.getElementById('search-recipe').value.toLowerCase();
    const filtered = recipesCache.filter(r => r.name.toLowerCase().includes(query));
    renderRecipeList(filtered);
}

// --- CRUD RICETTA ---
function openRecipeModal(recipe = null) {
    document.getElementById('recipe-modal').classList.remove('hidden');
    const container = document.getElementById('ingredients-list');
    container.innerHTML = '';
    
    if (recipe) {
        document.getElementById('modal-title').innerText = "Modifica Ricetta";
        document.getElementById('rec-id').value = recipe.id;
        document.getElementById('rec-name').value = recipe.name;
        document.getElementById('rec-type').value = recipe.type;
        document.getElementById('rec-servings').value = recipe.servings;
        document.getElementById('rec-difficulty').value = recipe.difficulty || 1;
        document.getElementById('rec-procedure').value = recipe.procedure || "";
        
        document.getElementById('btn-delete-rec').style.display = 'block';
        recipe.ingredients.forEach(ing => addIngredientRow(ing.name, ing.quantity));
    } else {
        document.getElementById('modal-title').innerText = "Nuova Ricetta";
        document.getElementById('rec-id').value = '';
        document.getElementById('rec-name').value = '';
        document.getElementById('rec-servings').value = 2;
        document.getElementById('rec-difficulty').value = 1;
        document.getElementById('rec-procedure').value = "";
        
        document.getElementById('btn-delete-rec').style.display = 'none';
        addIngredientRow(); 
    }
}

function addIngredientRow(name = '', qty = '') {
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    // Nota: Ho rimosso gli stili inline flex per affidarmi al CSS
    div.innerHTML = `
        <input type="text" placeholder="Ingrediente" class="ing-name" value="${name}">
        <input type="text" placeholder="Qtà" class="ing-qty" value="${qty}">
        <button class="btn-remove-ing" onclick="this.parentElement.remove()">✕</button>
    `;
    document.getElementById('ingredients-list').appendChild(div);
}

function closeRecipeModal() {
    document.getElementById('recipe-modal').classList.add('hidden');
}

async function saveRecipe() {
    const id = document.getElementById('rec-id').value;
    const body = {
        name: document.getElementById('rec-name').value,
        type: document.getElementById('rec-type').value,
        servings: document.getElementById('rec-servings').value,
        difficulty: document.getElementById('rec-difficulty').value,
        procedure: document.getElementById('rec-procedure').value,
        ingredients: []
    };
    
    document.querySelectorAll('.ingredient-row').forEach(row => {
        const n = row.querySelector('.ing-name').value;
        const q = row.querySelector('.ing-qty').value;
        if (n) body.ingredients.push({ name: n, quantity: q || 0 });
    });
    
    if (id) await apiCall(`/recipes/${id}`, 'PUT', body);
    else await apiCall('/recipes', 'POST', body);
    
    closeRecipeModal();
    loadRecipes();
}

async function deleteCurrentRecipe() {
    const id = document.getElementById('rec-id').value;
    if (!id || !(await showConfirm("Eliminare questa ricetta?"))) return;
    await apiCall(`/recipes/${id}`, 'DELETE');
    closeRecipeModal();
    loadRecipes();
}

// --- MENU & SPESA ---
function showGenerateModal() {
    document.getElementById('generate-modal').classList.remove('hidden');
}

async function loadLastMenu() {
    const res = await apiCall('/last-menu');
    const data = await res.json();
    if (!data) {
        await showAlert("Nessun menu salvato.");
        return;
    }
    renderMenuData(data);
}

async function generateMenu() {
    const people = document.getElementById('gen-people').value;
    document.getElementById('generate-modal').classList.add('hidden');
    
    const res = await apiCall('/generate-menu', 'POST', { people });
    if(res.ok) {
        renderMenuData(await res.json());
    } else {
        const err = await res.json();
        await showAlert(err.error);
    }
}

// Helper per generare l'HTML di una singola riga pasto (Dashboard)
function renderMealControl(day, type, meal, defaultPeople) {
    if (!meal) return `<div class="meal-row"><span>---</span></div>`;
    
    const currentServings = meal.customServings || defaultPeople;
    const typeEmoji = meal.type === 'primo' ? '🍝' : (meal.type === 'secondo' ? '🥩' : '🥘');
    const difficultyStars = "⭐".repeat(meal.difficulty || 1);
    
    const labelStyle = type === 'lunch' ? 'background:var(--bg-label-lunch, #e0f2fe); color:var(--text-label-lunch, #0369a1);' : 'background:var(--bg-label-dinner, #fef3c7); color:var(--text-label-dinner, #b45309);';
    const labelText = type === 'lunch' ? 'Pranzo' : 'Cena';

    return `
    <div class="meal-row-container">
        <div class="meal-label-box" style="${labelStyle}">
            ${labelText}
        </div>
        
        <div class="meal-info">
            <span style="font-weight: 500;">${typeEmoji} ${meal.name}</span>
            <span style="font-size:0.7rem; color:#999;">${difficultyStars}</span>
        </div>

        <div class="meal-controls">
            <button class="btn-icon" onclick="viewProcedure('${meal.name.replace(/'/g, "\\'")}', '${(meal.procedure || '').replace(/\r?\n/g, '<br>').replace(/'/g, "\\'")}')" title="Leggi Procedura">📖</button>
            
            <input type="number" 
                   value="${currentServings}" 
                   class="small-qty-input" 
                   onchange="changeMealServings(${day}, '${type}', this.value)" 
                   title="Persone">
            
            <button class="btn-icon" onclick="openMealSelector(${day}, '${type}')" title="Scegli Manualmente">🔍</button>
            <button class="btn-icon" onclick="regenerateSingleMeal(${day}, '${type}')" title="Randomizza Piatto">🔄</button>
        </div>
    </div>`;
}

function viewProcedure(title, text) {
    if(!text) text = "Nessuna procedura inserita per questo piatto.";
    showCustomDialog(title, `<div style="text-align:left; max-height:300px; overflow-y:auto;">${text}</div>`, 'alert');
}

function renderMenuData(data) {
    const shoppingTabEl = document.getElementById('tab-shopping');
    const isShoppingActive = shoppingTabEl && shoppingTabEl.classList.contains('active');

    showView('view-menu');

    // --- TAB MENU (Dashboard) ---
    const menuDiv = document.getElementById('weekly-menu-list');
    menuDiv.innerHTML = data.menu.map((d) => `
        <div class="menu-day-card">
            <div class="menu-card-header">
                <h4>Giorno ${d.day}</h4>
            </div>
            ${renderMealControl(d.day, 'lunch', d.lunch, data.people)}
            <hr class="meal-divider">
            ${renderMealControl(d.day, 'dinner', d.dinner, data.people)}
        </div>
    `).join('');
    
    // Dolce Card
    const desCard = document.getElementById('dessert-card');
    if(data.dessert) {
        desCard.classList.remove('hidden');
        desCard.className = 'menu-day-card';

        const currentDessertPeople = data.dessertPeople || data.people;
        const diffStars = "⭐".repeat(data.dessert.difficulty || 1);

        desCard.innerHTML = `
        <div class="menu-card-header">
        <h4 style="color:#d97706">🍰 Dolce della Settimana</h4>
        </div>
        <div class="meal-row-container">
        <div class="meal-label-box" style="visibility:hidden; width:0; padding:0; min-width:0;"></div>

        <div class="meal-info">
        <span style="font-weight: 500;">${data.dessert.name}</span>
        <span style="font-size:0.7rem; color:#999;">${diffStars}</span>
        </div>

        <div class="meal-controls">
        <button class="btn-icon" onclick="viewProcedure('${data.dessert.name.replace(/'/g, "\\'")}', '${(data.dessert.procedure || '').replace(/\r?\n/g, '<br>').replace(/'/g, "\\'")}')" title="Procedura">📖</button>

        <input type="number"
        value="${currentDessertPeople}"
        class="small-qty-input"
        onchange="changeDessertPeople(this.value)"
        title="Persone">

        <button class="btn-icon" onclick="openMealSelector(null, 'dessert')" title="Scegli Manualmente">🔍</button>
        <button class="btn-icon" onclick="regenerateDessert()" title="Cambia Random">🔄</button>
        </div>
        </div>
        `;
    } else {
        desCard.classList.add('hidden');
    }

    // --- TAB SPESA (Render Avanzato) ---
    renderShoppingList(data);

    // Ripristina Tab
    if (isShoppingActive) switchTab('tab-shopping');
    else switchTab('tab-menu');
}

// --- LOGICA SPESA AVANZATA ---

function toggleShoppingMode() {
    shoppingViewMode = (shoppingViewMode === 'cumulative') ? 'recipe' : 'cumulative';
    // Ricarica solo la vista (senza chiamata API) usando i dati dell'ultimo menu
    loadLastMenu(); 
}

function renderShoppingList(data) {
    const container = document.getElementById('shopping-container');
    const mainList = data.shoppingList.main || {};
    const dessertList = data.shoppingList.dessert || {};
    const extras = data.shoppingExtras || [];

    // Header Controlli Spesa
    let html = `
        <div class="shopping-toolbar">
            <button class="btn-small btn-secondary" onclick="toggleShoppingMode()">
                ${shoppingViewMode === 'cumulative' ? '📂 Vista per Ricetta' : '📝 Vista Unica'}
            </button>
            <button class="btn-small btn-success" onclick="addExtraItem()">+ Aggiungi</button>
        </div>
    `;

    // 1. Render EXTRAS (Sempre visibili in cima)
    if (extras.length > 0) {
        html += `<div class="shopping-section-title">✨ Extra Aggiunti</div>`;
        html += `<ul class="checklist">`;
        extras.forEach(item => {
            html += `
                <li class="${item.checked ? 'checked' : ''} extra-item">
                    <div class="check-area" onclick="toggleShoppingItem(null, '${item.name}', true)">
                        <span>${item.name}</span>
                    </div>
                    <div class="qty-area">
                         <b>${item.qty}</b>
                         <button class="btn-text" onclick="removeExtraItem(${item.id})">🗑</button>
                    </div>
                </li>`;
        });
        html += `</ul>`;
    }

    if (shoppingViewMode === 'cumulative') {
        // --- VISTA CUMULATIVA (Standard) ---
        
        const renderGroup = (listObj, category) => {
            if(Object.keys(listObj).length === 0) return '<p style="color:#999; padding:10px;">Vuoto.</p>';
            let s = '';
            Object.keys(listObj).forEach(k => {
                const item = listObj[k];
                const modClass = item.isModified ? 'modified-qty' : '';
                s += `<li class="${item.checked ? 'checked' : ''}">
                    <div class="check-area" onclick="toggleShoppingItem('${category}', '${k.replace(/'/g, "\\'")}')">
                        <span>${k}</span>
                    </div>
                    <div class="qty-area" onclick="editShoppingQty('${category}', '${k.replace(/'/g, "\\'")}', '${item.qty}')">
                        <b class="${modClass}">${item.qty}</b>
                        ${item.isModified ? '<span class="edit-dot">●</span>' : ''}
                    </div>
                </li>`;
            });
            return s;
        };

        html += `<div class="shopping-section-title">🛒 Pasti Principali</div>`;
        html += `<ul class="checklist">${renderGroup(mainList, 'main')}</ul>`;

        if (data.dessert) {
            html += `<div class="shopping-section-title" style="margin-top:20px; color:#d97706;">🍰 Dolce</div>`;
            html += `<ul class="checklist">${renderGroup(dessertList, 'dessert')}</ul>`;
        }

    } else {
        // --- VISTA PER RICETTA (Calcolata al volo per visualizzazione) ---
        // Nota: Le checkbox modificano comunque lo stato globale nell'oggetto shoppingList del server
        
        const renderRecipeIngredients = (meal, people, category) => {
            if (!meal) return '';
            const ratio = (meal.customServings || people) / meal.servings;
            const ingredients = meal.ingredients || []; // è già un array nel json

            if (ingredients.length === 0) return '';

            let s = `<div class="recipe-shopping-card">`;
            s += `<div class="recipe-shopping-header"><b>${meal.name}</b> (${meal.customServings || people}p)</div>`;
            s += `<ul class="checklist compact">`;
            
            ingredients.forEach(ing => {
                // Calcola quantità per questa specifica ricetta
                let qtyDisplay = "q.b.";
                const num = parseFloat(ing.quantity.toString().replace(',', '.'));
                if (!isNaN(num)) qtyDisplay = Math.round(num * ratio * 100) / 100;

                // Trova stato checked globale
                // Attenzione: deve matchare la chiave salvata nel server (Title Case)
                const key = ing.name.replace(/\b\w/g, l => l.toUpperCase());
                let isChecked = false;
                
                // Cerchiamo nel main o dessert
                if (category === 'dessert') {
                    if (dessertList[key] && dessertList[key].checked) isChecked = true;
                } else {
                    if (mainList[key] && mainList[key].checked) isChecked = true;
                }

                s += `<li class="${isChecked ? 'checked' : ''}" onclick="toggleShoppingItem('${category}', '${key.replace(/'/g, "\\'")}')">
                        <span>${ing.name}</span>
                        <span>${qtyDisplay}</span>
                      </li>`;
            });
            s += `</ul></div>`;
            return s;
        };

        html += `<div style="padding-top:10px;">`;
        
        // Loop Menu
        data.menu.forEach(d => {
            if(d.lunch) html += renderRecipeIngredients(d.lunch, data.people, 'main');
            if(d.dinner) html += renderRecipeIngredients(d.dinner, data.people, 'main');
        });

        // Dolce
        if(data.dessert) {
            html += renderRecipeIngredients(data.dessert, (data.dessertPeople || data.people), 'dessert');
        }
        
        html += `</div>`;
        html += `<div style="text-align:center; font-size:0.8rem; color:#666; margin-top:10px;">Nota: Spuntare un ingrediente lo segna come preso per tutte le ricette.</div>`;
    }

    container.innerHTML = html;
}


// --- AZIONI SPESA (API Calls) ---

async function toggleShoppingItem(category, itemName, isExtra = false) {
    const res = await apiCall('/toggle-shopping-item', 'POST', { category, item: itemName, isExtra });
    if (res.ok) {
        // Aggiorniamo i dati locali e ridisegniamo senza full reload
        const updatedData = await res.json();
        renderMenuData(updatedData);
    }
}

async function addExtraItem() {
    const name = await showPrompt("Cosa devi comprare?");
    if (!name) return;
    const qty = await showPrompt("Quantità?", "1");
    
    const res = await apiCall('/add-shopping-extra', 'POST', { name, qty });
    if(res.ok) renderMenuData(await res.json());
}

async function removeExtraItem(id) {
    if(!(await showConfirm("Rimuovere questo extra?"))) return;
    const res = await apiCall('/remove-shopping-extra', 'POST', { id });
    if(res.ok) renderMenuData(await res.json());
}

async function editShoppingQty(category, itemName, currentQty) {
    const newQty = await showPrompt(`Modifica quantità per ${itemName}:`, currentQty);
    if (newQty === null || newQty === currentQty) return; // Annullato o uguale

    const res = await apiCall('/update-shopping-qty', 'POST', { category, item: itemName, newQty });
    if(res.ok) renderMenuData(await res.json());
}


// --- AZIONI MENU: Rigenerazione Singola & Change Props ---

async function regenerateSingleMeal(day, type) {
    if(!(await showConfirm(`Vuoi cambiare questo piatto?`))) return;
    const res = await apiCall('/regenerate-meal', 'POST', { day, type });
    if(res.ok) renderMenuData(await res.json());
    else await showAlert("Impossibile aggiornare il piatto.");
}

async function changeMealServings(day, type, val) {
    if(val < 1) return;
    const res = await apiCall('/update-meal-servings', 'POST', { day, type, servings: val });
    if(res.ok) renderMenuData(await res.json());
}

async function regenerateDessert() {
    if(!(await showConfirm("Sicuro di voler cambiare il dolce?"))) return;
    const res = await apiCall('/regenerate-dessert', 'POST', {}); 
    if(res.ok) renderMenuData(await res.json());
    else await showAlert("Impossibile cambiare dolce.");
}

async function changeDessertPeople(val) {
    const res = await apiCall('/update-dessert-servings', 'POST', { servings: val });
    if(res.ok) renderMenuData(await res.json());
}

// --- SELETTORE MANUALE GENERALE (Pasti e Dolci) ---

async function openMealSelector(day, type) {
    contextSelection = { day, type };
    
    const res = await apiCall('/recipes');
    const allRecipes = await res.json();
    recipesCache = allRecipes; 

    const modal = document.getElementById('select-dessert-modal');
    const title = type === 'dessert' ? 'Scegli Dolce' : `Scegli per Giorno ${day}`;
    document.querySelector('#select-dessert-modal .modal-header h3').innerText = title;

    document.getElementById('search-dessert').value = '';
    
    const listToShow = (type === 'dessert') 
        ? allRecipes.filter(r => r.type === 'dolce') 
        : allRecipes.filter(r => r.type !== 'dolce'); 

    renderManualSelectionList(listToShow);
    modal.classList.remove('hidden');
}

function renderManualSelectionList(list) {
    const container = document.getElementById('dessert-selection-list');
    container.innerHTML = list.map(r => `
        <div class="recipe-card" onclick="selectManualRecipe(${r.id})">
            <div style="font-weight:bold; display:flex; justify-content:space-between; width:100%;">
                <span>
                    <span style="font-weight:normal; font-size:0.8rem">${r.type === 'primo' ? '🍝' : (r.type === 'secondo' ? '🥩' : '🍰')}</span>
                    ${r.name}
                </span>
                <span style="font-size:0.7rem; color:#888;">${"⭐".repeat(r.difficulty || 1)}</span>
            </div>
        </div>
    `).join('');

    if(list.length === 0) container.innerHTML = "<p>Nessuna ricetta trovata.</p>";
}

function filterManualSelection() {
    const query = document.getElementById('search-dessert').value.toLowerCase();
    
    let filtered = [];
    if (contextSelection.type === 'dessert') {
        filtered = recipesCache.filter(r => r.type === 'dolce' && r.name.toLowerCase().includes(query));
    } else {
        filtered = recipesCache.filter(r => r.type !== 'dolce' && r.name.toLowerCase().includes(query));
    }
    renderManualSelectionList(filtered);
}

async function selectManualRecipe(id) {
    document.getElementById('select-dessert-modal').classList.add('hidden');
    
    if (contextSelection.type === 'dessert') {
        const res = await apiCall('/set-manual-dessert', 'POST', { recipeId: id });
        if(res.ok) renderMenuData(await res.json());
    } else {
        const res = await apiCall('/set-manual-meal', 'POST', { 
            day: contextSelection.day, 
            type: contextSelection.type, 
            recipeId: id 
        });
        if(res.ok) renderMenuData(await res.json());
    }
}

// --- IMPORT / EXPORT JSON ---
function showBackupModal() {
    // Imposta il valore corretto della select prima di mostrare
    const currentPref = localStorage.getItem('familyMenuTheme') || 'auto';
    const selector = document.getElementById('theme-selector');
    if(selector) selector.value = currentPref;

    document.getElementById('backup-modal').classList.remove('hidden');
}

function exportJSON() {
    fetch(`${API_URL}/export-json`, { 
        headers: { 'Authorization': authToken } 
    })
    .then(res => res.blob())
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ricettario_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        document.getElementById('backup-modal').classList.add('hidden');
    });
}

async function importJSON(inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const jsonData = JSON.parse(e.target.result);
            const res = await apiCall('/import-json', 'POST', jsonData);
            const msg = await res.json();
            
            if (res.ok) {
                await showAlert(msg.message);
                const currentView = document.querySelector('.view.active');
                if(currentView && currentView.id === 'view-recipes') loadRecipes();
            } else {
                await showAlert("Errore: " + msg.error);
            }
            
        } catch (err) {
            await showAlert("File JSON non valido");
        }
        inputElement.value = ''; 
        document.getElementById('backup-modal').classList.add('hidden');
    };
    reader.readAsText(file);
}