const API_URL = '/api';
let authToken = localStorage.getItem('familyMenuToken');
let recipesCache = [];
let contextSelection = null; 
let currentMenuData = null; 

document.addEventListener('DOMContentLoaded', () => {
    applyTheme(); 
    if (authToken) {
        showView('view-dashboard');
        document.getElementById('navbar').classList.remove('hidden');
    } else {
        showView('view-login');
    }
});

// --- THEMING & UTILS (Invariati) ---
function getEasterDate(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return { month: Math.floor((h + l - 7 * m + 114) / 31), day: ((h + l - 7 * m + 114) % 31) + 1 };
}
function applyTheme() {
    const savedTheme = localStorage.getItem('familyMenuTheme') || 'auto';
    document.body.className = ''; 
    if (savedTheme !== 'auto') { document.body.classList.add(savedTheme); return; }
    const today = new Date();
    const m = today.getMonth() + 1, d = today.getDate(), y = today.getFullYear();
    const easter = getEasterDate(y);
    const easterDate = new Date(y, easter.month - 1, easter.day);
    const holySaturday = new Date(easterDate); holySaturday.setDate(easterDate.getDate() - 1);
    const easterMonday = new Date(easterDate); easterMonday.setDate(easterDate.getDate() + 1);
    const todayTime = new Date(y, m - 1, d).getTime();

    if (todayTime >= holySaturday.getTime() && todayTime <= easterMonday.getTime()) { document.body.classList.add('theme-easter'); return; }
    if (m === 12 || (m === 1 && d <= 6)) document.body.classList.add('theme-christmas');
    else if (m === 10 && d == 31) document.body.classList.add('theme-halloween');
    else if (m === 2 && d == 14) document.body.classList.add('theme-valentine');
    else if (m >= 3 && m <= 5) document.body.classList.add('theme-spring');
    else if (m >= 6 && m <= 8) document.body.classList.add('theme-summer');
    else if (m >= 9 && m <= 11) document.body.classList.add('theme-autumn');
    else document.body.classList.add('theme-winter');
}
function changeTheme(val) { localStorage.setItem('familyMenuTheme', val); applyTheme(); }

// --- DIALOGS (Invariati) ---
function showCustomDialog(title, message, type = 'alert', defaultValue = '') {
    return new Promise((resolve) => {
        const container = document.getElementById('custom-dialog-container');
        let inputField = type === 'prompt' ? `<input type="text" id="dialog-input" value="${defaultValue}" class="full-width" style="margin-top:10px;">` : '';
        container.innerHTML = `<div class="custom-dialog-overlay"><div class="custom-dialog-box"><h3>${title}</h3><div style="text-align:left; max-height:400px; overflow-y:auto; margin-bottom:10px;">${message}</div>${inputField}<div class="dialog-buttons">${type !== 'alert' ? `<button class="btn-secondary" id="dialog-cancel">Annulla</button>` : ''}<button class="btn-primary" id="dialog-ok">OK</button></div></div></div>`;
        const ok = document.getElementById('dialog-ok'), cancel = document.getElementById('dialog-cancel'), input = document.getElementById('dialog-input');
        if(input) input.focus();
        const close = (res) => { container.innerHTML = ''; resolve(res); };
        ok.onclick = () => close(type === 'prompt' ? input.value : true);
        if (cancel) cancel.onclick = () => close(false);
    });
}
async function showAlert(m) { await showCustomDialog("Avviso", `<p>${m}</p>`, 'alert'); }
async function showConfirm(m) { return await showCustomDialog("Conferma", `<p>${m}</p>`, 'confirm'); }
async function showPrompt(m, v='') { return await showCustomDialog("Inserisci", `<p>${m}</p>`, 'prompt', v); }

// --- NAV & AUTH ---
function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => {el.classList.remove('active'); el.classList.add('hidden');});
    const target = document.getElementById(viewId);
    target.classList.remove('hidden'); setTimeout(() => target.classList.add('active'), 10);
    const titles = {'view-dashboard': 'Dashboard', 'view-recipes': 'Ricettario', 'view-menu': 'Menu & Spesa'};
    const t = document.getElementById('nav-title'); if(t && titles[viewId]) t.innerText = titles[viewId];
}
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const btns = document.querySelectorAll('.tab-btn');
    if(tabId === 'tab-menu') btns[0].classList.add('active'); else btns[1].classList.add('active');
    document.getElementById(tabId).classList.add('active');
}
async function login() {
    const code = document.getElementById('access-code').value;
    const res = await fetch(`${API_URL}/login`, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({code})});
    if (res.ok) {
        const data = await res.json();
        authToken = `Bearer ${data.token}`; localStorage.setItem('familyMenuToken', authToken);
        document.getElementById('navbar').classList.remove('hidden'); showView('view-dashboard');
    } else document.getElementById('login-error').innerText = "Codice errato";
}
function logout() { localStorage.removeItem('familyMenuToken'); authToken = null; location.reload(); }
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = { 'Authorization': authToken };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_URL}${endpoint}`, {method, headers, body: body ? JSON.stringify(body) : null});
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

    // NUOVE CATEGORIE
    const groups = {
        'primo': { title: '🍝 Primi', items: [] },
        'secondo': { title: '🥩 Secondi Semplici', items: [] },
        'contorno': { title: '🥗 Contorni', items: [] },
        'secondo_completo': { title: '🥘 Secondi Completi', items: [] },
        'antipasto': { title: '🥟 Antipasti & Torte Salate', items: [] },
        'preparazione': { title: '🥣 Preparazioni & Altro', items: [] },
        'dolce': { title: '🍰 Dolci', items: [] }
    };

    list.forEach(r => {
        if(groups[r.type]) groups[r.type].items.push(r);
        else if (groups['preparazione']) groups['preparazione'].items.push(r); // Fallback
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
                div.innerHTML = `<div style="display:flex; flex-direction:column;"><span style="font-weight:bold">${r.name}</span><span style="font-size:0.75rem; color:#888;">${diffStars}</span></div><span>${r.servings}p</span>`;
                container.appendChild(div);
            });
        }
    });
}
function filterRecipes() {
    const query = document.getElementById('search-recipe').value.toLowerCase();
    renderRecipeList(recipesCache.filter(r => r.name.toLowerCase().includes(query)));
}

// --- MODALE RICETTA (READ-ONLY / EDIT) ---
function openRecipeModal(recipe = null) {
    document.getElementById('recipe-modal').classList.remove('hidden');
    const container = document.getElementById('ingredients-list');
    container.innerHTML = '';
    const fs = document.getElementById('recipe-fieldset');
    const btnEdit = document.getElementById('btn-edit-toggle');
    const btnSave = document.getElementById('btn-save-rec');
    const btnDel = document.getElementById('btn-delete-rec');
    const ta = document.getElementById('rec-procedure');

    // Default: Disabled (Read Only)
    fs.disabled = true;
    btnEdit.style.display = 'block';
    btnSave.style.display = 'none';
    btnDel.style.display = 'none';

    if (recipe) {
        document.getElementById('modal-title').innerText = "Dettagli Ricetta";
        document.getElementById('rec-id').value = recipe.id;
        document.getElementById('rec-name').value = recipe.name;
        document.getElementById('rec-type').value = recipe.type;
        document.getElementById('rec-servings').value = recipe.servings;
        document.getElementById('rec-difficulty').value = recipe.difficulty || 1;
        ta.value = recipe.procedure || "";
        recipe.ingredients.forEach(ing => addIngredientRow(ing.name, ing.quantity));
    } else {
        // Nuova Ricetta: Abilita subito modifica
        document.getElementById('modal-title').innerText = "Nuova Ricetta";
        document.getElementById('rec-id').value = '';
        document.getElementById('rec-name').value = '';
        document.getElementById('rec-servings').value = 2;
        document.getElementById('rec-difficulty').value = 1;
        ta.value = "";
        addIngredientRow(); 
        toggleEditMode(); // Attiva editing per nuova
    }
    autoResize(ta);
}

function toggleEditMode() {
    const fs = document.getElementById('recipe-fieldset');
    const btnEdit = document.getElementById('btn-edit-toggle');
    const btnSave = document.getElementById('btn-save-rec');
    const btnDel = document.getElementById('btn-delete-rec');
    const isNew = !document.getElementById('rec-id').value;

    fs.disabled = false;
    btnEdit.style.display = 'none';
    btnSave.style.display = 'block';
    if(!isNew) btnDel.style.display = 'block';
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

function addIngredientRow(name = '', qty = '') {
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    div.innerHTML = `<input type="text" placeholder="Ingrediente" class="ing-name" value="${name}"><input type="text" placeholder="Qtà" class="ing-qty" value="${qty}"><button type="button" class="btn-remove-ing" onclick="this.parentElement.remove()">✕</button>`;
    document.getElementById('ingredients-list').appendChild(div);
}

function closeRecipeModal() { document.getElementById('recipe-modal').classList.add('hidden'); }

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
    closeRecipeModal(); loadRecipes();
}
async function deleteCurrentRecipe() {
    const id = document.getElementById('rec-id').value;
    if (!id || !(await showConfirm("Eliminare questa ricetta?"))) return;
    await apiCall(`/recipes/${id}`, 'DELETE');
    closeRecipeModal(); loadRecipes();
}

// --- MENU & DASHBOARD ---
function showGenerateModal() { document.getElementById('generate-modal').classList.remove('hidden'); }
async function loadLastMenu() {
    const res = await apiCall('/last-menu');
    const data = await res.json();
    if (!data) { await showAlert("Nessun menu salvato."); return; }
    renderMenuData(data);
}
async function generateMenu() {
    const people = document.getElementById('gen-people').value;
    document.getElementById('generate-modal').classList.add('hidden');
    const res = await apiCall('/generate-menu', 'POST', { people });
    if(res.ok) renderMenuData(await res.json());
    else { const err = await res.json(); await showAlert(err.error); }
}

// Helper: Visualizza singolo item o array di items (composite)
function renderMealControl(day, type, meal, defaultPeople, isExtra = false) {
    // Se non c'è pasto
    if (!meal) return `<div class="meal-row"><span>---</span></div>`;
    
    // Gestione ID unico per i pasti extra per poterli modificare/rimuovere
    const uniqueId = isExtra ? meal.uniqueId : null;
    
    // items: array se è composito (Secondo + Contorno)
    let itemsToRender = [];
    let isComposite = false;
    
    if (meal.items && Array.isArray(meal.items)) {
        itemsToRender = meal.items;
        isComposite = true;
    } else {
        itemsToRender = [meal];
    }

    const currentServings = meal.customServings || defaultPeople;
    const diffStars = "⭐".repeat(meal.difficulty || 1);
    
    let labelStyle, labelText;
    if (isExtra) {
        labelStyle = 'background:#f3e8ff; color:#7e22ce;'; 
        labelText = 'Extra';
    } else {
        labelStyle = type === 'lunch' ? 'background:var(--bg-label-lunch); color:var(--text-label-lunch);' : 'background:var(--bg-label-dinner); color:var(--text-label-dinner);';
        labelText = type === 'lunch' ? 'Pranzo' : 'Cena';
    }

    // Costruzione righe nomi
    const namesHtml = itemsToRender.map(it => {
        const typeEmoji = it.type === 'primo' ? '🍝' : (it.type === 'secondo' ? '🥩' : (it.type === 'contorno' ? '🥗' : '🥘'));
        return `<div style="display:flex; align-items:center; margin-bottom:2px;">
                    <span style="font-size:1rem; font-weight: 500;">${typeEmoji} ${it.name}</span>
                </div>`;
    }).join('');

    // Parametri per onClick
    // Se è extra, passiamo null come day/type e usiamo uniqueId
    const dayParam = isExtra ? 'null' : day;
    const typeParam = isExtra ? `'manual_extra'` : `'${type}'`; // Type fittizio per extra
    const extraIdParam = isExtra ? uniqueId : 'null';

    const deleteBtn = isExtra ? `<button class="btn-icon" style="color:red;" onclick="removeManualMeal(${uniqueId})" title="Rimuovi">🗑</button>` : '';

    return `
    <div class="meal-row-container">
        <div class="meal-top-row">
            <div class="meal-label-box" style="${labelStyle}">${labelText}</div>
            <div class="meal-info">
                ${namesHtml}
                <span style="font-size:0.6rem; color:#999;">${diffStars}</span>
            </div>
        </div>
        <div class="meal-bottom-row">
            <div class="meal-controls">
                <button class="btn-icon" onclick="openRecipeDetails(${dayParam}, ${typeParam}, ${extraIdParam})" title="Leggi">📖</button>
                <input type="number" value="${currentServings}" class="small-qty-input" 
                       onchange="changeMealServings(${dayParam}, ${typeParam}, this.value, ${extraIdParam})" title="Persone">
                ${deleteBtn}
                <button class="btn-icon" onclick="openMealSelector(${dayParam}, ${typeParam}, ${extraIdParam})" title="Scegli">🔍</button>
                ${!isExtra ? `<button class="btn-icon" onclick="regenerateSingleMeal(${day}, '${type}')" title="Randomizza">🔄</button>` : ''}
            </div>
        </div>
    </div>`;
}

// Mostra dettagli (ingredienti e procedura) combinati
function openRecipeDetails(day, type, extraId = null) {
    if(!currentMenuData) return;

    let meal, currentServings;

    if (type === 'dessert') {
        meal = currentMenuData.dessert;
        currentServings = currentMenuData.dessertPeople || currentMenuData.people;
    } else if (extraId) {
        meal = currentMenuData.extraMeals.find(e => e.uniqueId == extraId);
        currentServings = meal.customServings || currentMenuData.people;
    } else {
        const dayData = currentMenuData.menu.find(d => d.day === day);
        if(dayData) meal = dayData[type];
        currentServings = meal.customServings || currentMenuData.people;
    }

    if(!meal) return;

    let htmlContent = '';
    
    // Gestione array items (composite) o singolo
    const items = (meal.items && Array.isArray(meal.items)) ? meal.items : [meal];

    items.forEach((subItem, idx) => {
        const ratio = currentServings / (subItem.servings || 2);
        
        if (items.length > 1) htmlContent += `<h4 style="margin:10px 0 5px; color:var(--primary)">${subItem.name}</h4>`;
        
        htmlContent += '<p style="font-size:0.9rem;"><b>Ingredienti:</b></p><ul style="font-size:0.9rem; padding-left:20px;">';
        
        const ings = typeof subItem.ingredients === 'string' ? JSON.parse(subItem.ingredients) : subItem.ingredients;
        ings.forEach(ing => {
            let displayQty = "q.b.";
            const num = parseFloat(ing.quantity.toString().replace(',', '.'));
            if (!isNaN(num)) displayQty = Math.round(num * ratio * 100) / 100;
            htmlContent += `<li>${ing.name}: <b>${displayQty}</b></li>`;
        });
        htmlContent += '</ul>';

        const proc = (subItem.procedure || "Nessuna procedura.").replace(/\r?\n/g, '<br>');
        htmlContent += `<p style="font-size:0.9rem; margin-top:5px;"><b>Procedimento:</b></p><div style="font-size:0.9rem; color:#555; background:#f9f9f9; padding:10px; border-radius:8px;">${proc}</div>`;
        
        if (idx < items.length - 1) htmlContent += '<hr>';
    });

    showCustomDialog(meal.name || "Dettagli Piatto", htmlContent, 'alert');
}

function renderMenuData(data) {
    currentMenuData = data;
    const shoppingTabEl = document.getElementById('tab-shopping');
    const isShoppingActive = shoppingTabEl && shoppingTabEl.classList.contains('active');
    showView('view-menu');

    // 1. Menu Settimanale
    document.getElementById('weekly-menu-list').innerHTML = data.menu.map(d => `
        <div class="menu-day-card">
            <div class="menu-card-header"><h4>Giorno ${d.day}</h4></div>
            ${renderMealControl(d.day, 'lunch', d.lunch, data.people)}
            <hr class="meal-divider">
            ${renderMealControl(d.day, 'dinner', d.dinner, data.people)}
        </div>
    `).join('');

    // 2. Pasti Extra
    const extraDiv = document.getElementById('extra-meals-list');
    extraDiv.innerHTML = '';
    if (data.extraMeals && data.extraMeals.length > 0) {
        data.extraMeals.forEach(m => {
            const wrap = document.createElement('div');
            wrap.className = 'menu-day-card'; 
            wrap.innerHTML = renderMealControl(null, 'manual', m, data.people, true);
            extraDiv.appendChild(wrap);
        });
    }

    // 3. Dessert (Ora in fondo)
    const desCard = document.getElementById('dessert-card');
    if(data.dessert) {
        desCard.classList.remove('hidden');
        desCard.className = 'menu-day-card';
        const currentDessertPeople = data.dessertPeople || data.people;
        const diffStars = "⭐".repeat(data.dessert.difficulty || 1);
        desCard.innerHTML = `
        <div class="menu-card-header"><h4 style="color:#d97706">🍰 Dolce della Settimana</h4></div>
        <div class="meal-row-container">
            <div class="meal-top-row">
                <div class="meal-label-box" style="visibility:hidden; width:0; padding:0; min-width:0;"></div>
                <div class="meal-info"><span style="font-weight: 500;">${data.dessert.name}</span><span style="font-size:0.7rem; color:#999;">${diffStars}</span></div>
            </div>
            <div class="meal-bottom-row"><div class="meal-controls">
                <button class="btn-icon" onclick="openRecipeDetails(null, 'dessert')" title="Procedura">📖</button>
                <input type="number" value="${currentDessertPeople}" class="small-qty-input" onchange="changeDessertPeople(this.value)" title="Persone">
                <button class="btn-icon" onclick="openMealSelector(null, 'dessert')" title="Scegli">🔍</button>
                <button class="btn-icon" onclick="regenerateDessert()" title="Cambia">🔄</button>
            </div></div>
        </div>`;
    } else desCard.classList.add('hidden');

    renderShoppingList(data);
    if (isShoppingActive) switchTab('tab-shopping'); else switchTab('tab-menu');
}

function renderShoppingList(data) {
    const container = document.getElementById('shopping-container');
    const mainList = data.shoppingList.main || {};
    const extras = data.shoppingExtras || [];
    let html = `<div class="shopping-toolbar"><button class="btn-small btn-success" onclick="addExtraItem()">+ Aggiungi</button></div>`;
    
    if (extras.length > 0) {
        html += `<div class="shopping-section-title">✨ Extra Aggiunti</div><ul class="checklist">`;
        extras.forEach(item => {
            html += `<li class="${item.checked ? 'checked' : ''}"><div class="check-area" onclick="toggleShoppingItem(null, '${item.name}', true)"><span style="color:var(--primary);">${item.checked ? '✔' : ''}</span><span>${item.name}</span></div><div class="qty-area"><b>${item.qty}</b><button class="btn-text" onclick="removeExtraItem(${item.id})">🗑</button></div></li>`;
        });
        html += `</ul><div style="text-align:right; margin-top:5px;"><button class="btn-text" style="color:var(--accent); font-size:0.8rem;" onclick="clearManualList()">🗑 Svuota lista manuale</button></div>`;
    }

    const renderGroup = (listObj, cat) => {
        if(Object.keys(listObj).length === 0) return '<p style="color:#999; padding:10px;">Vuoto.</p>';
        let s = '';
        Object.keys(listObj).forEach(k => {
            const i = listObj[k];
            s += `<li class="${i.checked ? 'checked' : ''}"><div class="check-area" onclick="toggleShoppingItem('${cat}', '${k.replace(/'/g, "\\'")}')"><span style="color:var(--primary);">${i.checked ? '✔' : ''}</span><span>${k}</span></div><div class="qty-area" onclick="editShoppingQty('${cat}', '${k.replace(/'/g, "\\'")}', '${i.qty}')"><b class="${i.isModified ? 'modified-qty' : ''}">${i.qty}</b>${i.isModified ? '<span class="edit-dot">●</span>' : ''}</div></li>`;
        });
        return s;
    };
    html += `<div class="shopping-section-title">🛒 Lista della Spesa</div><ul class="checklist">${renderGroup(mainList, 'main')}</ul>`;
    container.innerHTML = html;
}

// --- ACTIONS ---
async function toggleShoppingItem(cat, item, isExtra = false) {
    const res = await apiCall('/toggle-shopping-item', 'POST', { category: cat, item, isExtra });
    if (res.ok) renderMenuData(await res.json());
}
async function addExtraItem() {
    const name = await showPrompt("Cosa devi comprare?"); if (!name) return;
    const qty = await showPrompt("Quantità?", "1");
    const res = await apiCall('/add-shopping-extra', 'POST', { name, qty });
    if(res.ok) renderMenuData(await res.json());
}
async function removeExtraItem(id) {
    if(!(await showConfirm("Rimuovere?"))) return;
    const res = await apiCall('/remove-shopping-extra', 'POST', { id });
    if(res.ok) renderMenuData(await res.json());
}
async function clearManualList() {
    if(!(await showConfirm("Svuotare tutto?"))) return;
    const res = await apiCall('/clear-shopping-extras', 'POST', {});
    if(res.ok) renderMenuData(await res.json());
}
async function editShoppingQty(cat, item, current) {
    const n = await showPrompt(`Modifica quantità per ${item}:`, current);
    if (n === false || n === null || n === current) return; 
    const res = await apiCall('/update-shopping-qty', 'POST', { category: cat, item, newQty: n });
    if(res.ok) renderMenuData(await res.json());
}

async function regenerateSingleMeal(day, type) {
    if(!(await showConfirm(`Cambiare questo piatto?`))) return;
    const res = await apiCall('/regenerate-meal', 'POST', { day, type });
    if(res.ok) renderMenuData(await res.json());
}
async function changeMealServings(day, type, val, extraId = null) {
    if(val < 1) return;
    const res = await apiCall('/update-meal-servings', 'POST', { day, type, servings: val, extraId });
    if(res.ok) renderMenuData(await res.json());
}
async function regenerateDessert() {
    if(!(await showConfirm("Cambiare dolce?"))) return;
    const res = await apiCall('/regenerate-dessert', 'POST', {}); 
    if(res.ok) renderMenuData(await res.json());
}
async function changeDessertPeople(val) {
    const res = await apiCall('/update-dessert-servings', 'POST', { servings: val });
    if(res.ok) renderMenuData(await res.json());
}

// --- MANUAL SELECTION ---
async function openMealSelector(day, type, extraId = null) {
    contextSelection = { day, type, extraId };
    const res = await apiCall('/recipes');
    recipesCache = await res.json();
    const modal = document.getElementById('select-dessert-modal');
    document.querySelector('#select-dessert-modal .modal-header h3').innerText = (type === 'dessert') ? 'Scegli Dolce' : 'Scegli Piatto';
    document.getElementById('search-dessert').value = '';
    const listToShow = (type === 'dessert') ? recipesCache.filter(r => r.type === 'dolce') : recipesCache.filter(r => r.type !== 'dolce'); 
    renderManualSelectionList(listToShow);
    modal.classList.remove('hidden');
}

function renderManualSelectionList(list) {
    const container = document.getElementById('dessert-selection-list');
    container.innerHTML = list.map(r => `<div class="recipe-card" onclick="selectManualRecipe(${r.id})"><div style="font-weight:bold; display:flex; justify-content:space-between; width:100%;"><span><span style="font-weight:normal; font-size:0.8rem">${r.type === 'primo'?'🍝':(r.type.includes('secondo')?'🥩':'🥘')}</span> ${r.name}</span><span style="font-size:0.7rem; color:#888;">${"⭐".repeat(r.difficulty||1)}</span></div></div>`).join('');
    if(list.length === 0) container.innerHTML = "<p>Nessuna ricetta.</p>";
}

function filterManualSelection() {
    const q = document.getElementById('search-dessert').value.toLowerCase();
    let f = [];
    if (contextSelection.type === 'dessert') f = recipesCache.filter(r => r.type === 'dolce' && r.name.toLowerCase().includes(q));
    else f = recipesCache.filter(r => r.type !== 'dolce' && r.name.toLowerCase().includes(q));
    renderManualSelectionList(f);
}

async function selectManualRecipe(id) {
    document.getElementById('select-dessert-modal').classList.add('hidden');
    if (contextSelection.type === 'dessert') {
        const res = await apiCall('/set-manual-dessert', 'POST', { recipeId: id });
        if(res.ok) renderMenuData(await res.json());
    } else if (contextSelection.type === 'manual_add') {
        // Aggiungi nuova card extra
        const res = await apiCall('/add-manual-meal', 'POST', { recipeId: id });
        if(res.ok) renderMenuData(await res.json());
    } else {
        // Sostituisci pasto esistente (o extra esistente)
        const res = await apiCall('/set-manual-meal', 'POST', { 
            day: contextSelection.day, 
            type: contextSelection.type, 
            recipeId: id,
            extraId: contextSelection.extraId 
        });
        if(res.ok) renderMenuData(await res.json());
    }
}

async function removeManualMeal(uniqueId) {
    if(!(await showConfirm("Rimuovere questo piatto extra?"))) return;
    const res = await apiCall('/remove-manual-meal', 'POST', { uniqueId });
    if(res.ok) renderMenuData(await res.json());
}

// IMPORT/EXPORT
function showBackupModal() { document.getElementById('backup-modal').classList.remove('hidden'); }
function exportJSON() {
    fetch(`${API_URL}/export-json`, { headers: { 'Authorization': authToken } }).then(res => res.blob()).then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); a.remove(); document.getElementById('backup-modal').classList.add('hidden');
    });
}
async function importJSON(el) {
    const file = el.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const j = JSON.parse(e.target.result);
            const res = await apiCall('/import-json', 'POST', j);
            if (res.ok) { await showAlert("Import completato"); loadRecipes(); } 
            else await showAlert("Errore import");
        } catch (err) { await showAlert("JSON non valido"); }
        el.value = ''; document.getElementById('backup-modal').classList.add('hidden');
    };
    reader.readAsText(file);
}