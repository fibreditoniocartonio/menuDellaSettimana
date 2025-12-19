const API_URL = '/api';
let authToken = localStorage.getItem('familyMenuToken');

// Inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    if (authToken) {
        showApp();
    }
});

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
        showApp();
    } else {
        document.getElementById('login-error').innerText = "Codice errato";
    }
}

function logout() {
    localStorage.removeItem('familyMenuToken');
    authToken = null;
    location.reload();
}

function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
}

// --- API WRAPPER ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = { 'Authorization': authToken };
    if (body) headers['Content-Type'] = 'application/json';
    
    const res = await fetch(`${API_URL}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
    });
    
    if (res.status === 401) logout();
    return res.json();
}

// --- RICETTE ---
let recipesCache = [];

async function loadRecipes() {
    document.getElementById('recipes-section').classList.remove('hidden');
    document.getElementById('menu-section').classList.add('hidden');
    
    recipesCache = await apiCall('/recipes');
    renderRecipeList();
}

function renderRecipeList() {
    const list = document.getElementById('recipes-list');
    list.innerHTML = '';
    
    recipesCache.forEach(r => {
        const div = document.createElement('div');
        div.className = 'recipe-item';
        div.innerHTML = `
            <input type="checkbox" value="${r.id}" onchange="handleSelection()">
            <div style="flex:1">
                <strong>${r.name}</strong> (${r.type}) <br>
                <small>Per ${r.servings} pers.</small>
            </div>
        `;
        list.appendChild(div);
    });
    handleSelection();
}

function handleSelection() {
    const checkboxes = document.querySelectorAll('#recipes-list input:checked');
    const btnEdit = document.getElementById('btn-edit');
    const btnDelete = document.getElementById('btn-delete');
    
    btnEdit.disabled = checkboxes.length !== 1;
    btnDelete.disabled = checkboxes.length === 0;
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
        
        recipe.ingredients.forEach(ing => addIngredientRow(ing.name, ing.quantity));
    } else {
        document.getElementById('modal-title').innerText = "Nuova Ricetta";
        document.getElementById('rec-id').value = '';
        document.getElementById('rec-name').value = '';
        document.getElementById('rec-servings').value = 2;
        addIngredientRow(); // Una riga vuota
    }
}

function addIngredientRow(name = '', qty = '') {
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    div.innerHTML = `
        <input type="text" placeholder="Ingrediente" class="ing-name" value="${name}">
        <input type="number" placeholder="Quantità (es. gr)" class="ing-qty" value="${qty}">
        <button class="btn-danger" onclick="this.parentElement.remove()">X</button>
    `;
    document.getElementById('ingredients-list').appendChild(div);
}

function closeRecipeModal() {
    document.getElementById('recipe-modal').classList.add('hidden');
}

async function saveRecipe() {
    const id = document.getElementById('rec-id').value;
    const name = document.getElementById('rec-name').value;
    const type = document.getElementById('rec-type').value;
    const servings = document.getElementById('rec-servings').value;
    
    // Raccogli ingredienti
    const ingredients = [];
    document.querySelectorAll('.ingredient-row').forEach(row => {
        const n = row.querySelector('.ing-name').value;
        const q = row.querySelector('.ing-qty').value;
        if (n) ingredients.push({ name: n, quantity: q || 0 });
    });
    
    const body = { name, type, servings, ingredients };
    
    if (id) {
        await apiCall(`/recipes/${id}`, 'PUT', body);
    } else {
        await apiCall('/recipes', 'POST', body);
    }
    
    closeRecipeModal();
    loadRecipes();
}

async function deleteSelectedRecipes() {
    if (!confirm("Sei sicuro di voler eliminare le ricette selezionate?")) return;
    
    const checkboxes = document.querySelectorAll('#recipes-list input:checked');
    for (const box of checkboxes) {
        await apiCall(`/recipes/${box.value}`, 'DELETE');
    }
    loadRecipes();
}

function editSelectedRecipe() {
    const id = document.querySelector('#recipes-list input:checked').value;
    const recipe = recipesCache.find(r => r.id == id);
    openRecipeModal(recipe);
}

// --- GENERAZIONE MENU ---
function showGenerateModal() {
    document.getElementById('generate-modal').classList.remove('hidden');
}

async function generateMenu() {
    const people = document.getElementById('gen-people').value;
    document.getElementById('generate-modal').classList.add('hidden');
    
    const data = await apiCall('/generate-menu', 'POST', { people });
    
    document.getElementById('menu-section').classList.remove('hidden');
    document.getElementById('recipes-section').classList.add('hidden');
    
    // Render Menu
    const menuDiv = document.getElementById('weekly-menu-display');
    menuDiv.innerHTML = '<h4>Menu Settimanale</h4><ul>' + 
        data.menu.map(d => `
            <li>
                <strong>Giorno ${d.day}</strong><br>
                Pranzo: ${d.lunch ? d.lunch.name : '---'} <br>
                Cena: ${d.dinner ? d.dinner.name : '---'}
            </li>
        `).join('') + '</ul>';
        
    // Render Shopping List
    const shopDiv = document.getElementById('shopping-list-display');
    const listHtml = Object.keys(data.shoppingList).map(k => 
        `<li>${k}: <b>${Math.ceil(data.shoppingList[k])}</b></li>`
    ).join('');
    
    shopDiv.innerHTML = `<h4>Lista Spesa (per ${people} pers.)</h4><ul>${listHtml || 'Niente da comprare'}</ul>`;
}