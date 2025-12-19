const API_URL = '/api';
let authToken = localStorage.getItem('familyMenuToken');
let recipesCache = [];

// INIT
document.addEventListener('DOMContentLoaded', () => {
    if (authToken) {
        showView('view-dashboard');
        document.getElementById('navbar').classList.remove('hidden');
    } else {
        showView('view-login');
    }
});

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

    // Raggruppamento per tipo
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
    if (!id || !confirm("Eliminare questa ricetta?")) return;
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
        alert("Nessun menu salvato.");
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
        alert(err.error);
    }
}

function renderMenuData(data) {
    showView('view-menu');
    switchTab('tab-menu');

    // Menu Giornaliero
    const menuDiv = document.getElementById('weekly-menu-list');
    menuDiv.innerHTML = data.menu.map((d, i) => `
        <div class="menu-day-card">
            <div class="menu-card-header">
                <h4>Giorno ${d.day}</h4>
                <button class="btn-icon" onclick="regenerateDay(${d.day})" title="Cambia menu">🔄</button>
            </div>
            <div class="meal-row">
                <span class="meal-label">Pranzo</span>
                <span>${d.lunch ? d.lunch.name : '---'}</span>
            </div>
            <div class="meal-row">
                <span class="meal-label">Cena</span>
                <span>${d.dinner ? d.dinner.name : '---'}</span>
            </div>
        </div>
    `).join('');
    
    // Dolce
    const desCard = document.getElementById('dessert-card');
    if(data.dessert) {
        desCard.classList.remove('hidden');
        desCard.innerHTML = `
            <div class="menu-card-header">
                <h4 style="color:#d97706">🍰 Dolce della Settimana</h4>
                <button class="btn-icon" onclick="regenerateDessert()" title="Cambia dolce">🔄</button>
            </div>
            <div class="meal-row">
                <span class="meal-label">Scelta</span>
                <span>${data.dessert.name}</span>
            </div>
        `;
    } else {
        desCard.classList.add('hidden');
    }

    // Lista Spesa
    const shopList = document.getElementById('shopping-list-ul');
    shopList.innerHTML = Object.keys(data.shoppingList).map(k => 
        `<li onclick="this.classList.toggle('checked')">
            <span>${k}</span>
            <b>${data.shoppingList[k]}</b>
        </li>`
    ).join('');
}

// --- NUOVE FUNZIONI DI RIGENERAZIONE ---
async function regenerateDay(dayNumber) {
    if(!confirm(`Vuoi cambiare le ricette del Giorno ${dayNumber}?`)) return;
    const res = await apiCall('/regenerate-day', 'POST', { day: dayNumber });
    if(res.ok) renderMenuData(await res.json());
    else alert("Errore durante aggiornamento");
}

async function regenerateDessert() {
    const res = await apiCall('/regenerate-dessert', 'POST', {}); 
    if(res.ok) renderMenuData(await res.json());
    else alert("Impossibile cambiare dolce (forse non ce ne sono altri?)");
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
                alert(msg.message);
                loadRecipes(); // Ricarica lista se siamo lì
            } else {
                alert("Errore: " + msg.error);
            }
            
        } catch (err) {
            alert("File JSON non valido");
        }
        inputElement.value = ''; 
        document.getElementById('backup-modal').classList.add('hidden');
    };
    reader.readAsText(file);
}