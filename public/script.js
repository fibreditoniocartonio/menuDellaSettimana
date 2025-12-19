const API_URL = '/api';
let authToken = localStorage.getItem('familyMenuToken');
let recipesCache = [];
let contextSelection = null; // Memorizza il contesto (giorno/pasto) per la selezione manuale

// INIT
document.addEventListener('DOMContentLoaded', () => {
    if (authToken) {
        showView('view-dashboard');
        document.getElementById('navbar').classList.remove('hidden');
    } else {
        showView('view-login');
    }
});

// --- CUSTOM ALERTS & CONFIRMS ---
function showCustomDialog(title, message, isConfirm = false) {
    return new Promise((resolve) => {
        const container = document.getElementById('custom-dialog-container');
        container.innerHTML = `
            <div class="custom-dialog-overlay">
                <div class="custom-dialog-box">
                    <h3>${title}</h3>
                    <p>${message}</p>
                    <div class="dialog-buttons">
                        ${isConfirm ? `<button class="btn-secondary" id="dialog-cancel">Annulla</button>` : ''}
                        <button class="btn-primary" id="dialog-ok">OK</button>
                    </div>
                </div>
            </div>
        `;

        const okBtn = document.getElementById('dialog-ok');
        const cancelBtn = document.getElementById('dialog-cancel');

        const close = (result) => {
            container.innerHTML = '';
            resolve(result);
        };

        okBtn.onclick = () => close(true);
        if (cancelBtn) cancelBtn.onclick = () => close(false);
    });
}

async function showAlert(message) {
    await showCustomDialog("Avviso", message, false);
}

async function showConfirm(message) {
    return await showCustomDialog("Conferma", message, true);
}

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
                const div = document.createElement('div');
                div.className = 'recipe-card';
                div.onclick = () => openRecipeModal(r);
                div.innerHTML = `
                    <div style="font-weight:bold">${r.name}</div>
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
        document.getElementById('btn-delete-rec').style.display = 'block';
        recipe.ingredients.forEach(ing => addIngredientRow(ing.name, ing.quantity));
    } else {
        document.getElementById('modal-title').innerText = "Nuova Ricetta";
        document.getElementById('rec-id').value = '';
        document.getElementById('rec-name').value = '';
        document.getElementById('rec-servings').value = 2;
        document.getElementById('btn-delete-rec').style.display = 'none';
        addIngredientRow(); 
    }
}

function addIngredientRow(name = '', qty = '') {
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    div.innerHTML = `
        <input type="text" placeholder="Ingrediente" class="ing-name" value="${name}" style="flex:2">
        <input type="text" placeholder="Qtà" class="ing-qty" value="${qty}" style="flex:1">
        <button class="btn-text" onclick="this.parentElement.remove()">✕</button>
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

// Helper per generare l'HTML di una singola riga pasto
function renderMealControl(day, type, meal, defaultPeople) {
    if (!meal) return `<div class="meal-row"><span>---</span></div>`;
    
    const currentServings = meal.customServings || defaultPeople;
    const typeEmoji = meal.type === 'primo' ? '🍝' : (meal.type === 'secondo' ? '🥩' : '🥘');
    
    const labelStyle = type === 'lunch' ? 'background:#e0f2fe; color:#0369a1;' : 'background:#fef3c7; color:#b45309;';
    const labelText = type === 'lunch' ? 'Pranzo' : 'Cena';

    return `
    <div class="meal-row" style="flex-wrap: wrap; gap: 8px;">
        <div class="meal-label-box" style="${labelStyle} padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; min-width: 60px; text-align: center;">
            ${labelText}
        </div>
        
        <div style="flex-grow: 1; display: flex; flex-direction: column;">
            <span style="font-weight: 500;">${typeEmoji} ${meal.name}</span>
        </div>

        <div class="meal-controls" style="display: flex; align-items: center; gap: 5px;">
            <input type="number" 
                   value="${currentServings}" 
                   class="small-qty-input" 
                   onchange="changeMealServings(${day}, '${type}', this.value)" 
                   title="Persone">
            
            <button class="btn-icon" onclick="openMealSelector(${day}, '${type}')" title="Scegli Manualmente">
                🔍
            </button>
            
            <button class="btn-icon" onclick="regenerateSingleMeal(${day}, '${type}')" title="Randomizza Piatto">
                🔄
            </button>
        </div>
    </div>`;
}

function renderMenuData(data) {
    // 1. MEMORIZZA QUALE TAB È ATTIVO PRIMA DI RIDISEGNARE
    // Se l'elemento #tab-shopping ha la classe 'active', significa che l'utente è lì.
    const shoppingTabEl = document.getElementById('tab-shopping');
    const isShoppingActive = shoppingTabEl && shoppingTabEl.classList.contains('active');

    showView('view-menu');

    // Menu Giornaliero
    const menuDiv = document.getElementById('weekly-menu-list');
    menuDiv.innerHTML = data.menu.map((d) => `
        <div class="menu-day-card">
            <div class="menu-card-header">
                <h4>Giorno ${d.day}</h4>
            </div>
            ${renderMealControl(d.day, 'lunch', d.lunch, data.people)}
            <hr style="border:0; border-top:1px dashed #eee; margin: 10px 0;">
            ${renderMealControl(d.day, 'dinner', d.dinner, data.people)}
        </div>
    `).join('');
    
    // Dolce
    const desCard = document.getElementById('dessert-card');
    if(data.dessert) {
        desCard.classList.remove('hidden');
        const currentDessertPeople = data.dessertPeople || data.people;
        
        desCard.innerHTML = `
            <div class="menu-card-header">
                <h4 style="color:#d97706">🍰 Dolce della Settimana</h4>
                <div class="dessert-controls">
                    <button class="btn-icon" onclick="openMealSelector(null, 'dessert')" title="Scegli Manualmente">🔍</button>
                    <button class="btn-icon" onclick="regenerateDessert()" title="Cambia Random">🔄</button>
                </div>
            </div>
            <div class="meal-row" style="margin-bottom:15px;">
                <span>${data.dessert.name}</span>
            </div>
             <div class="meal-row" style="background:#fff3cd; padding:8px; border-radius:6px; justify-content:space-between;">
                <span class="meal-label" style="width:auto;">Per quante persone?</span>
                <input type="number" class="dessert-people-input" value="${currentDessertPeople}" onchange="changeDessertPeople(this.value)">
            </div>
        `;
    } else {
        desCard.classList.add('hidden');
    }

    // Lista Spesa
    const shopContainer = document.getElementById('shopping-container');
    let html = '';

    const mainList = data.shoppingList.main || data.shoppingList;
    const dessertList = data.shoppingList.dessert || {};

    const renderListItems = (listObj, category) => {
        if(Object.keys(listObj).length === 0) return '<p style="color:#999; padding:10px;">Niente qui.</p>';
        return Object.keys(listObj).map(k => {
            const item = listObj[k];
            return `<li class="${item.checked ? 'checked' : ''}" 
                        onclick="toggleShoppingItem('${category}', '${k.replace(/'/g, "\\'")}')">
                <span>${k}</span>
                <b>${item.qty}</b>
            </li>`;
        }).join('');
    };

    html += `<div class="shopping-section-title">🛒 Pasti Principali</div>`;
    html += `<ul class="checklist">${renderListItems(mainList, 'main')}</ul>`;

    if (data.dessert) {
        html += `<div class="shopping-section-title" style="margin-top:30px; color:#d97706;">🍰 Dolce</div>`;
        html += `<ul class="checklist">${renderListItems(dessertList, 'dessert')}</ul>`;
    }

    shopContainer.innerHTML = html;

    // 2. RIPRISTINA IL TAB CORRETTO
    if (isShoppingActive) {
        switchTab('tab-shopping');
    } else {
        switchTab('tab-menu');
    }
}

// --- NUOVA FUNZIONE: Toggle Spesa Server-Side ---
async function toggleShoppingItem(category, itemName) {
    const res = await apiCall('/toggle-shopping-item', 'POST', { category, item: itemName });
    if (res.ok) {
        const updatedData = await res.json();
        renderMenuData(updatedData);
    }
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
            <div style="font-weight:bold">
                <span style="font-weight:normal; font-size:0.8rem">${r.type === 'primo' ? '🍝' : (r.type === 'secondo' ? '🥩' : '🍰')}</span>
                ${r.name}
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