const API_URL = '/api';
let authToken = localStorage.getItem('familyMenuToken');
let recipesCache = [];
let contextSelection = null;
let currentMenuData = null;
let isMenuLoaded = false;

// STATO PER ABBINAMENTI MANUALI
let pendingPairing = null;
// STATO PER CONFRONTO IMPORT
let pendingCompareData = null;

document.addEventListener('DOMContentLoaded', () => {
    // Inizializza select UI
    const savedUi = localStorage.getItem('familyMenuUiMode') || 'auto';
    const uiSel = document.getElementById('ui-mode-selector');
    if(uiSel) uiSel.value = savedUi;

    // Inizializza select Tema
    const savedTheme = localStorage.getItem('familyMenuTheme') || 'auto';
    const themeSel = document.getElementById('theme-selector');
    if(themeSel) themeSel.value = savedTheme;

    applyTheme();
    if (authToken) {
        showView('view-dashboard');
        document.getElementById('navbar').classList.remove('hidden');
    } else {
        showView('view-login');
    }
});

// --- THEMING & UTILS ---
function getEasterDate(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return { month: Math.floor((h + l - 7 * m + 114) / 31), day: ((h + l - 7 * m + 114) % 31) + 1 };
}

async function applyTheme() {
    let themeName = 'winter'; // Default
    const savedTheme = localStorage.getItem('familyMenuTheme') || 'auto';

    // Rimuove classi tema esistenti
    document.body.classList.forEach(cls => {
        if(cls.startsWith('theme-')) document.body.classList.remove(cls);
    });

        if (savedTheme !== 'auto') {
            themeName = savedTheme.replace('theme-', '');
            document.body.classList.add(savedTheme);
        } else {
            const today = new Date();
            const m = today.getMonth() + 1, d = today.getDate(), y = today.getFullYear();
            const easter = getEasterDate(y);
            const easterDate = new Date(y, easter.month - 1, easter.day);
            const holySaturday = new Date(easterDate); holySaturday.setDate(easterDate.getDate() - 1);
            const easterMonday = new Date(easterDate); easterMonday.setDate(easterDate.getDate() + 1);
            const todayTime = new Date(y, m - 1, d).getTime();

            if (todayTime >= holySaturday.getTime() && todayTime <= easterMonday.getTime()) {
                themeName = 'easter';
            } else if (m === 12 || (m === 1 && d <= 6)) {
                themeName = 'christmas';
            } else if (m === 10 && d == 31) {
                themeName = 'halloween';
            } else if (m === 2 && d == 14) {
                themeName = 'valentine';
            } else if (m >= 3 && m <= 5) {
                themeName = 'spring';
            } else if (m >= 6 && m <= 8) {
                themeName = 'summer';
            } else if (m >= 9 && m <= 11) {
                themeName = 'autumn';
            } else {
                themeName = 'winter';
            }
            document.body.classList.add('theme-' + themeName);
        }

        // Caricamento casuale dello sfondo
        urlBgImage = "";
        try {
            const res = await fetch(`/api/background/${themeName}`);
            if (res.ok) {
                const data = await res.json();
                urlBgImage = `bg/${data.filename}`;
                if (data.filename) {
                    document.body.style.setProperty('--bg-image', `url('bg/${data.filename}')`);
                } else {
                    document.body.style.removeProperty('--bg-image');
                }
            }
        } catch (e) {
            console.warn("Impossibile caricare sfondo dinamico", e);
        }
        //applico i coloriUI
        await applyUiMode(themeName, urlBgImage);
}

function changeTheme(val) {
    localStorage.setItem('familyMenuTheme', val);
    applyTheme();
}

function changeUiMode(val) {
    localStorage.setItem('familyMenuUiMode', val);
    applyTheme();
}

async function applyUiMode(currentThemeName, urlBgImage) {
    const mode = localStorage.getItem('familyMenuUiMode') || 'auto';
    const body = document.body;
    const brightness = await detectImageBrightness(urlBgImage);

    body.classList.remove('ui-colorful');
    if (mode === 'colorful' || (mode === 'auto' && brightness>190) ) {
        body.classList.add('ui-colorful');
    }
}

async function detectImageBrightness(imageSrc) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imageSrc;
        img.style.display = "none";

        img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = 50;
            canvas.height = 50;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 50, 50);

            const imageData = ctx.getImageData(0, 0, 50, 50);
            const data = imageData.data;
            let r, g, b, avg;
            let colorSum = 0;

            for(let x = 0, len = data.length; x < len; x += 4) {
                r = data[x];
                g = data[x+1];
                b = data[x+2];
                avg = Math.floor((r + g + b) / 3);
                colorSum += avg;
            }

            const brightness = Math.floor(colorSum / (50*50));
            resolve(brightness);
        };

        img.onerror = function() {
            resolve(255);
        }
    });
}

// --- LEVENSHTEIN & FUZZY SEARCH ---
function levenshteinDistance(a, b) {
    const tmp = [];
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    for (let i = 0; i <= b.length; i++) tmp[i] = [i];
    for (let j = 0; j <= a.length; j++) tmp[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                tmp[i][j] = tmp[i - 1][j - 1];
            } else {
                tmp[i][j] = Math.min(
                    tmp[i - 1][j - 1] + 1,
                    tmp[i][j - 1] + 1,
                    tmp[i - 1][j] + 1
                );
            }
        }
    }
    return tmp[b.length][a.length];
}

function isFuzzyMatch(str1, str2) {
    const s1 = str1.trim().toLowerCase();
    const s2 = str2.trim().toLowerCase();
    if (s1 === s2) return true;

    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return true;

    const dist = levenshteinDistance(s1, s2);
    // Tolleranza: 20% della lunghezza o max 3 caratteri per parole corte
    const threshold = Math.max(2, Math.floor(maxLen * 0.2));

    return dist <= threshold;
}

// --- DIALOGS ---
function showCustomDialog(title, message, type = 'alert', defaultValue = '') {
    return new Promise((resolve) => {
        const container = document.getElementById('custom-dialog-container');
        let inputField = type === 'prompt' ? `<input type="text" id="dialog-input" value="${defaultValue}" class="full-width" style="margin-top:10px;">` : '';
        const cancelBtn = type !== 'alert' ? `<button class="btn-secondary" id="dialog-cancel">Annulla</button>` : '';

        let customBtns = '';
        if (type === 'pairing') {
            customBtns = `<button class="btn-secondary" id="dialog-no">No, tieni singolo</button><button class="btn-primary" id="dialog-yes">Sì, scegli abbinamento</button>`;
        } else if (type === 'conflict') {
            customBtns = `
            <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
            <button class="btn-secondary full-width" id="dialog-compare" style="color:var(--text);">🔍 Confronta dettagli</button>
            <div class="conflict-buttons-row">
            <button class="btn-secondary" id="dialog-no">Tieni Vecchia</button>
            <button class="btn-primary" id="dialog-keep-both">Tieni Entrambe</button>
            <button class="btn-danger" id="dialog-yes">Sostituisci</button>
            </div>
            </div>`;
        } else if (type === 'import_choice') {
            customBtns = `<div style="display:flex; flex-direction:column; gap:10px; width:100%"><button class="btn-primary full-width" id="dialog-yes">Aggiungi (Unisci)</button><button class="btn-secondary full-width" id="dialog-manual">Scegli manualmente cosa aggiungere</button><button class="btn-danger full-width" id="dialog-no">Sostituisci Tutto (Cancella DB)</button><button class="btn-text full-width" id="dialog-cancel">Annulla</button></div>`;
        } else {
            customBtns = `${cancelBtn}<button class="btn-primary" id="dialog-ok">OK</button>`;
        }

        const wideClass = type === 'conflict' ? 'dialog-wide' : '';

        container.innerHTML = `<div class="custom-dialog-overlay" id="dialog-overlay"><div class="custom-dialog-box ${wideClass}"><h3>${title}</h3><div style="text-align:left; max-height:400px; overflow-y:auto; margin-bottom:10px;">${message}</div>${inputField}<div class="dialog-buttons">${customBtns}</div></div></div>`;

        const ok = document.getElementById('dialog-ok');
        const cancel = document.getElementById('dialog-cancel');
        const input = document.getElementById('dialog-input');

        const yes = document.getElementById('dialog-yes');
        const no = document.getElementById('dialog-no');
        const manual = document.getElementById('dialog-manual');
        const keepBoth = document.getElementById('dialog-keep-both');
        const compare = document.getElementById('dialog-compare');

        if(input) input.focus();
        const close = (res) => { container.innerHTML = ''; resolve(res); };

        if(ok) ok.onclick = () => close(type === 'prompt' ? input.value : true);
        if(cancel) cancel.onclick = () => close(false);
        if(yes) yes.onclick = () => close('yes');
        if(no) no.onclick = () => close('no');
        if(manual) manual.onclick = () => close('manual');
        if(keepBoth) keepBoth.onclick = () => close('keep_both');

        if(type === 'pairing' && yes) yes.onclick = () => close('pair');
        if(type === 'pairing' && no) no.onclick = () => close('single');

        if(compare) {
            compare.onclick = () => {
                openFullComparisonOverlay();
            };
        }
    });
}
async function showAlert(m) { await showCustomDialog("Avviso", `<p>${m}</p>`, 'alert'); }
async function showConfirm(m) { return await showCustomDialog("Conferma", `<p>${m}</p>`, 'confirm'); }
async function showPrompt(m, v='') { return await showCustomDialog("Inserisci", `<p>${m}</p>`, 'prompt', v); }
async function showPairingConfirm(itemType, pairType) {
    const map = { 'sugo': 'un sugo', 'primo': 'un primo', 'secondo': 'un secondo', 'contorno': 'un contorno' };
    return await showCustomDialog("Abbinamento", `<p>Hai selezionato ${map[itemType] || itemType}.<br>Vuoi abbinarci ${map[pairType] || pairType}?</p>`, 'pairing');
}

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
    if (recipesCache.length === 0) {
        const res = await apiCall('/recipes');
        recipesCache = await res.json();
    }
    renderRecipeList(recipesCache);
}

function renderRecipeList(list) {
    const container = document.getElementById('recipes-list');
    container.innerHTML = '';
    const groups = {
        'primo': { title: '🍚 Primi Semplici (da abbinare a un Sugo)', items: [] },
        'sugo': { title: '🍅 Sughi e Salse', items: [] },
        'primo_completo': { title: '🍝 Primi Completi (Lasagne/Forni)', items: [] },
        'secondo': { title: '🥩 Secondi Semplici (da abbinare a un contorno)', items: [] },
        'contorno': { title: '🍟 Contorni', items: [] },
        'secondo_completo': { title: '🥘 Secondi Completi', items: [] },
        'antipasto': { title: '🥟 Antipasti & Torte Salate', items: [] },
        'panificato': { title: '🥖 Pane e Pizze', items: [] },
        'dolce': { title: '🍰 Dolci', items: [] },
        'preparazione': { title: '🥣 Preparazioni & Altro', items: [] }
    };
    list.forEach(r => {
        if(groups[r.type]) groups[r.type].items.push(r);
        else if (groups['preparazione']) groups['preparazione'].items.push(r);
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
                    div.innerHTML = `<div style="display:flex; flex-direction:column;"><span style="font-weight:bold">${r.name}</span><span style="font-size:0.75rem; color:var(--text-light);">${diffStars}</span></div><span>${r.servings}p</span>`;
                    container.appendChild(div);
                });
            }
        });
}
function filterRecipes() {
    const query = document.getElementById('search-recipe').value.toLowerCase();
    renderRecipeList(recipesCache.filter(r => r.name.toLowerCase().includes(query)));
}

// --- MODALE RICETTA ---
function openRecipeModal(recipe = null) {
    document.getElementById('recipe-modal').classList.remove('hidden');
    const container = document.getElementById('ingredients-list');
    container.innerHTML = '';
    const fs = document.getElementById('recipe-fieldset');
    const btnEdit = document.getElementById('btn-edit-toggle');
    const btnSave = document.getElementById('btn-save-rec');
    const btnDel = document.getElementById('btn-delete-rec');
    const ta = document.getElementById('rec-procedure');

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
        document.getElementById('modal-title').innerText = "Nuova Ricetta";
        document.getElementById('rec-id').value = '';
        document.getElementById('rec-name').value = '';
        document.getElementById('rec-servings').value = 2;
        document.getElementById('rec-difficulty').value = 1;
        ta.value = "";
        addIngredientRow();
        toggleEditMode();
    }

    setTimeout(() => {
        autoResize(ta);
    }, 50);
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
    textarea.style.height = (textarea.scrollHeight + 2) + 'px';
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
    recipesCache = [];
    isMenuLoaded = false;
    closeRecipeModal(); loadRecipes();
}
async function deleteCurrentRecipe() {
    const id = document.getElementById('rec-id').value;
    if (!id || !(await showConfirm("Eliminare questa ricetta?"))) return;
    await apiCall(`/recipes/${id}`, 'DELETE');
    recipesCache = [];
    isMenuLoaded = false;
    closeRecipeModal(); loadRecipes();
}

// --- MENU & DASHBOARD ---
function showGenerateModal() { document.getElementById('generate-modal').classList.remove('hidden'); }
async function loadLastMenu() {
    const res = await apiCall('/last-menu');
    const data = await res.json();
    if (!data) { await showAlert("Nessun menu salvato."); return; }
    isMenuLoaded = true;
    renderMenuData(data);
    if(document.getElementById('view-menu').classList.contains('hidden')) {
        showView('view-menu');
        switchTab('tab-menu');
    }
}
async function generateMenu() {
    const people = document.getElementById('gen-people').value;
    document.getElementById('generate-modal').classList.add('hidden');
    const res = await apiCall('/generate-menu', 'POST', { people });
    if(res.ok) {
        isMenuLoaded = true;
        renderMenuData(await res.json());
    } else { const err = await res.json(); await showAlert(err.error); }
}

function getEmojiForType(type) {
    if (!type) return '🥘';
    const t = type.toLowerCase();
    if (t.includes('primo')) return '🍝';
    if (t === 'sugo') return '🍅';
    if (t.includes('secondo')) return '🥩';
    if (t === 'contorno') return '🥗';
    if (t === 'antipasto') return '🥟';
    if (t === 'panificato') return '🥖';
    if (t === 'dolce') return '🍰';
    if (t === 'preparazione') return '🥣';
    return '🥘';
}

function renderMealControl(day, type, meal, defaultPeople, isExtra = false) {
    if (!meal) return `<div class="meal-row"><span>---</span></div>`;
    const uniqueId = isExtra ? meal.uniqueId : null;
    let itemsToRender = (meal.items && Array.isArray(meal.items)) ? meal.items : [meal];
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

    const namesHtml = itemsToRender.map(it => {
        const typeEmoji = getEmojiForType(it.type);
        return `<div style="display:flex; align-items:center; margin-bottom:2px;"><span style="font-size:1rem; font-weight: 500;">${typeEmoji} ${it.name}</span></div>`;
    }).join('');

    const dayParam = isExtra ? 'null' : day;
    const typeParam = isExtra ? `'manual_extra'` : `'${type}'`;
    const extraIdParam = isExtra ? uniqueId : 'null';
    const deleteBtn = isExtra ? `<button class="btn-icon" style="color:red;" onclick="removeManualMeal(${uniqueId})" title="Rimuovi">🗑</button>` : '';

    return `<div class="meal-row-container"><div class="meal-top-row"><div class="meal-label-box" style="${labelStyle}">${labelText}</div><div class="meal-info">${namesHtml}<span style="font-size:0.6rem; color:var(--text-light);">${diffStars}</span></div></div><div class="meal-bottom-row"><div class="meal-controls"><button class="btn-icon" onclick="openRecipeDetails(${dayParam}, ${typeParam}, ${extraIdParam})" title="Leggi">📖</button><input type="number" value="${currentServings}" class="small-qty-input" onchange="changeMealServings(${dayParam}, ${typeParam}, this.value, ${extraIdParam})" title="Persone">${deleteBtn}<button class="btn-icon" onclick="openMealSelector(${dayParam}, ${typeParam}, ${extraIdParam})" title="Scegli">🔍</button>${!isExtra ? `<button class="btn-icon" onclick="regenerateSingleMeal(${day}, '${type}')" title="Randomizza">🔄</button>` : ''}</div></div></div>`;
}

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
    const items = (meal.items && Array.isArray(meal.items)) ? meal.items : [meal];
    items.forEach((subItem, idx) => {
        const ratio = currentServings / (subItem.servings || 2);
        if (items.length > 1) htmlContent += `<h4 style="margin:10px 0 5px; color:var(--text)">${subItem.name}</h4>`;
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
        htmlContent += `<p style="font-size:0.9rem; margin-top:5px;"><b>Procedimento:</b></p><div style="font-size:0.9rem; padding:10px; border: 1px solid; border-radius:8px;">${proc}</div>`;
        if (idx < items.length - 1) htmlContent += '<hr>';
    });
        showCustomDialog(meal.name || "Dettagli Piatto", htmlContent, 'alert');
}

function renderMenuData(data) {
    currentMenuData = data;
    const shoppingTabEl = document.getElementById('tab-shopping');
    const isShoppingActive = shoppingTabEl && shoppingTabEl.classList.contains('active');
    showView('view-menu');
    document.getElementById('weekly-menu-list').innerHTML = data.menu.map(d => `
    <div class="menu-day-card">
    <div class="menu-card-header"><h4>Giorno ${d.day}</h4></div>
    ${renderMealControl(d.day, 'lunch', d.lunch, data.people)}
    <hr class="meal-divider">
    ${renderMealControl(d.day, 'dinner', d.dinner, data.people)}
    </div>
    `).join('');
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
    const desCard = document.getElementById('dessert-card');
    if(data.dessert) {
        desCard.classList.remove('hidden');
        desCard.className = 'menu-day-card';
        const currentDessertPeople = data.dessertPeople || data.people;
        const diffStars = "⭐".repeat(data.dessert.difficulty || 1);
        desCard.innerHTML = `
        <div class="menu-card-header"><h4 style="color:#d97706">🍰 Dolce della Settimana</h4></div>
        <div class="meal-row-container"><div class="meal-top-row"><div class="meal-label-box" style="visibility:hidden; width:0; padding:0; min-width:0;"></div><div class="meal-info"><span style="font-weight: 500;">${data.dessert.name}</span><span style="font-size:0.7rem; color:var(--text-light);">${diffStars}</span></div></div><div class="meal-bottom-row"><div class="meal-controls"><button class="btn-icon" onclick="openRecipeDetails(null, 'dessert')" title="Procedura">📖</button><input type="number" value="${currentDessertPeople}" class="small-qty-input" onchange="changeDessertPeople(this.value)" title="Persone"><button class="btn-icon" onclick="openMealSelector(null, 'dessert')" title="Scegli">🔍</button><button class="btn-icon" onclick="regenerateDessert()" title="Cambia">🔄</button></div></div></div>`;
    } else desCard.classList.add('hidden');
    renderShoppingList(data);
    if (isShoppingActive) switchTab('tab-shopping'); else switchTab('tab-menu');
}

function renderShoppingList(data) {
    const container = document.getElementById('shopping-container');
    const mainList = data.shoppingList.main || {};
    const extras = data.shoppingExtras || [];
    let html = `<div class="shopping-toolbar"><button class="btn-small btn-secondary" onclick="addExtraItem()">+ Aggiungi</button></div>`;
    if (extras.length > 0) {
        html += `<div class="shopping-section-title">✨ Extra Aggiunti</div><ul class="checklist">`;
        extras.forEach(item => {
            html += `<li class="${item.checked ? 'checked' : ''}" id="extra-${item.id}"><div class="check-area" onclick="toggleShoppingItem(null, '${item.name}', true, this)"><span class="check-icon">${item.checked ? '✔' : ''}</span><span>${item.name}</span></div><div class="qty-area"><b>${item.qty}</b><button class="btn-text" onclick="removeExtraItem(${item.id})">🗑</button></div></li>`;
        });
        html += `</ul><div style="text-align:right; margin-top:5px;"><button class="btn-text" style="color:var(--accent); font-size:0.8rem;" onclick="clearManualList()">🗑 Svuota lista manuale</button></div>`;
    }
    const renderGroup = (listObj, cat) => {
        if(Object.keys(listObj).length === 0) return '<p style="color:var(--text-light); padding:10px;">Vuoto.</p>';
        let s = '';
        Object.keys(listObj).forEach(k => {
            const i = listObj[k];
            const safeKey = k.replace(/[^a-zA-Z0-9]/g, '_');
            const rowId = `${cat}-${safeKey}`;

            let infoBtn = '';
            if (i.usages && i.usages.length > 0) {
                infoBtn = `<button class="btn-info" onclick="showIngredientDetails('${k.replace(/'/g, "\\'")}')" title="Vedi Ricette">📖</button>`;
            }

            s += `<li class="${i.checked ? 'checked' : ''}" id="${rowId}"><div class="check-area" onclick="toggleShoppingItem('${cat}', '${k.replace(/'/g, "\\'")}', false, this)"><span class="check-icon">${i.checked ? '✔' : ''}</span><span>${k}</span></div><div class="qty-area">${infoBtn}<span onclick="editShoppingQty('${cat}', '${k.replace(/'/g, "\\'")}', '${i.qty}')"><b class="${i.isModified ? 'modified-qty' : ''}">${i.qty}</b>${i.isModified ? '<span class="edit-dot">●</span>' : ''}</span></div></li>`;
        });
        return s;
    };
    html += `<div class="shopping-section-title">🛒 Lista della Spesa <button class="btn-refresh" onclick="loadLastMenu()" title="Ricarica">⟲</button></div><ul class="checklist">${renderGroup(mainList, 'main')}</ul>`;
    container.innerHTML = html;
}

function showIngredientDetails(itemKey) {
    if (!currentMenuData || !currentMenuData.shoppingList.main[itemKey]) return;
    const item = currentMenuData.shoppingList.main[itemKey];

    if (!item.usages || item.usages.length === 0) return;

    let html = `<ul style="padding-left:0; list-style:none;">`;
    item.usages.forEach(u => {
        let roundedQty = u.qty;
        if (typeof u.qty === 'number') {
            roundedQty = Math.round(u.qty * 100) / 100;
        }
        html += `<li style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; flex-direction:column;">
        <span style="font-weight:bold; color:var(--text); font-size:0.9rem;">${u.recipe}</span>
        <span style="font-size:0.75rem; color:var(--text-light);">${u.context}</span>
        </div>
        <span style="font-weight:bold; padding:2px 6px; border-radius:4px; font-size:0.85rem;">${roundedQty}</span>
        </li>`;
    });
    html += `</ul>`;

    showCustomDialog(`${itemKey}`, html, 'alert');
}

// --- ACTIONS & OPTIMISTIC UI ---
function toggleShoppingItem(cat, item, isExtra, domEl) {
    const li = domEl.closest('li');
    const icon = li.querySelector('.check-icon');
    const isNowChecked = !li.classList.contains('checked');
    if(isNowChecked) { li.classList.add('checked'); icon.innerText = '✔'; } else { li.classList.remove('checked'); icon.innerText = ''; }
    if (isExtra) {
        const extraItem = currentMenuData.shoppingExtras.find(x => x.name === item);
        if (extraItem) extraItem.checked = isNowChecked;
    } else {
        if (currentMenuData.shoppingList[cat][item]) currentMenuData.shoppingList[cat][item].checked = isNowChecked;
    }
    apiCall('/toggle-shopping-item', 'POST', { category: cat, item, isExtra }).then(res => {
        if(!res.ok) { if(isNowChecked) { li.classList.remove('checked'); icon.innerText=''; } else { li.classList.add('checked'); icon.innerText='✔'; } }
    });
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
    pendingPairing = null;

    if (recipesCache.length === 0) {
        const res = await apiCall('/recipes');
        recipesCache = await res.json();
    }

    const modal = document.getElementById('select-dessert-modal');
    document.querySelector('#select-dessert-modal .modal-header h3').innerText = (type === 'dessert') ? 'Scegli Dolce' : 'Scegli Piatto';
    document.getElementById('search-dessert').value = '';

    let listToShow = [];
    if (type === 'dessert') {
        listToShow = recipesCache.filter(r => r.type === 'dolce');
    } else if (type === 'manual_add') {
        listToShow = recipesCache;
    } else {
        listToShow = recipesCache.filter(r => r.type !== 'dolce');
    }

    renderManualSelectionList(listToShow);
    modal.classList.remove('hidden');
}

function renderManualSelectionList(list) {
    const container = document.getElementById('dessert-selection-list');
    container.innerHTML = '';
    const groups = {
        'primo': { title: '🍝 Primi Semplici', items: [] },
        'primo_completo': { title: '🍝 Primi Completi', items: [] },
        'sugo': { title: '🍅 Sughi e Salse', items: [] },
        'secondo': { title: '🥩 Secondi Semplici', items: [] },
        'contorno': { title: '🥗 Contorni', items: [] },
        'secondo_completo': { title: '🥘 Secondi Completi', items: [] },
        'antipasto': { title: '🥟 Antipasti & Torte', items: [] },
        'panificato': { title: '🥖 Pane e Pizze', items: [] },
        'preparazione': { title: '🥣 Preparazioni', items: [] },
        'dolce': { title: '🍰 Dolci', items: [] }
    };
    list.forEach(r => {
        if(groups[r.type]) groups[r.type].items.push(r);
        else if (groups['preparazione']) groups['preparazione'].items.push(r);
    });
        let hasItems = false;
        Object.keys(groups).forEach(key => {
            const group = groups[key];
            if(group.items.length > 0) {
                hasItems = true;
                const header = document.createElement('div');
                header.style.marginTop = '15px'; header.style.marginBottom = '5px'; header.style.color = 'var(--primary)'; header.style.fontWeight = '800'; header.style.fontSize = '0.85rem'; header.style.textTransform = 'uppercase';
                header.innerText = group.title;
                container.appendChild(header);
                group.items.forEach(r => {
                    const div = document.createElement('div');
                    div.className = 'recipe-card';
                    div.onclick = () => selectManualRecipe(r.id);
                    div.style.marginBottom = '8px';
                    div.innerHTML = `<div style="font-weight:bold; display:flex; justify-content:space-between; width:100%;"><span>${r.name}</span><span style="font-size:0.7rem; color:var(--text-light);">${"⭐".repeat(r.difficulty||1)}</span></div>`;
                    container.appendChild(div);
                });
            }
        });
        if(!hasItems) container.innerHTML = "<p>Nessuna ricetta trovata.</p>";
}

function filterManualSelection() {
    const q = document.getElementById('search-dessert').value.toLowerCase();

    if (pendingPairing) {
        let targetType = '';
        if (pendingPairing.type === 'primo') targetType = 'sugo';
        else if (pendingPairing.type === 'sugo') targetType = 'primo';
        else if (pendingPairing.type === 'secondo') targetType = 'contorno';
        else if (pendingPairing.type === 'contorno') targetType = 'secondo';

        const filtered = recipesCache.filter(r => r.type === targetType && r.name.toLowerCase().includes(q));
        renderManualSelectionList(filtered);
        return;
    }

    let baseList = [];
    if (contextSelection.type === 'dessert') {
        baseList = recipesCache.filter(r => r.type === 'dolce');
    } else if (contextSelection.type === 'manual_add') {
        baseList = recipesCache;
    } else {
        baseList = recipesCache.filter(r => r.type !== 'dolce');
    }
    const filtered = baseList.filter(r => r.name.toLowerCase().includes(q));
    renderManualSelectionList(filtered);
}

async function selectManualRecipe(id) {
    const selected = recipesCache.find(r => r.id === id);
    if (!selected) return;

    if (pendingPairing) {
        document.getElementById('select-dessert-modal').classList.add('hidden');
        isMenuLoaded = false;

        const payload = {
            recipeId: pendingPairing.id,
            pairedRecipeId: id
        };

        if (contextSelection.type === 'manual_add') {
            const res = await apiCall('/add-manual-meal', 'POST', payload);
            if(res.ok) renderMenuData(await res.json());
        } else {
            payload.day = contextSelection.day;
            payload.type = contextSelection.type;
            payload.extraId = contextSelection.extraId;
            const res = await apiCall('/set-manual-meal', 'POST', payload);
            if(res.ok) renderMenuData(await res.json());
        }

        pendingPairing = null;
        return;
    }

    const pairableTypes = ['primo', 'sugo', 'secondo', 'contorno'];

    if (pairableTypes.includes(selected.type)) {
        let pairType = '';
        if (selected.type === 'primo') pairType = 'sugo';
        else if (selected.type === 'sugo') pairType = 'primo';
        else if (selected.type === 'secondo') pairType = 'contorno';
        else if (selected.type === 'contorno') pairType = 'secondo';

        const choice = await showPairingConfirm(selected.type, pairType);

        if (choice === 'pair') {
            pendingPairing = selected;
            document.querySelector('#select-dessert-modal .modal-header h3').innerText = `Scegli ${pairType.charAt(0).toUpperCase() + pairType.slice(1)}`;
            document.getElementById('search-dessert').value = '';

            const filtered = recipesCache.filter(r => r.type === pairType);
            renderManualSelectionList(filtered);
            return;
        }
    }

    document.getElementById('select-dessert-modal').classList.add('hidden');
    isMenuLoaded = false;

    if (contextSelection.type === 'dessert') {
        const res = await apiCall('/set-manual-dessert', 'POST', { recipeId: id });
        if(res.ok) renderMenuData(await res.json());
    } else if (contextSelection.type === 'manual_add') {
        const res = await apiCall('/add-manual-meal', 'POST', { recipeId: id });
        if(res.ok) renderMenuData(await res.json());
    } else {
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

async function exportJSON() {
    if (recipesCache.length === 0) {
        const res = await apiCall('/recipes');
        recipesCache = await res.json();
    }

    const selected = await showRecipeSelectionDialog(recipesCache, "Esporta Ricette", "Esporta Selezionate");
    if (!selected) return;

    const payload = {};
    if (selected.length < recipesCache.length) {
        payload.ids = selected.map(r => r.id);
    }

    const res = await apiCall('/export-json', 'POST', payload);
    if(res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        document.getElementById('backup-modal').classList.add('hidden');
    } else {
        await showAlert("Errore durante l'export.");
    }
}

// --- LOGICA IMPORT AVANZATA ---

function formatRecipeFull(r) {
    if(!r) return "<p>Vuoto</p>";
    const ings = r.ingredients.map(i => `<li><b>${i.name}</b>: ${i.quantity}</li>`).join('');
    return `
    <h2 style="margin-top:0; color:var(--text);">${r.name}</h2>
    <p style="var(--text);">Tipologia: ${r.type} | Difficoltà: ${r.difficulty}/5</p>
    <hr>
    <h4>Ingredienti</h4>
    <ul>${ings}</ul>
    <h4>Procedura</h4>
    <div style="padding:15px; border-radius:12px; border: 1px solid var(--text); line-height:1.5;">${r.procedure.replace(/\n/g, '<br>')}</div>
    `;
}

function openFullComparisonOverlay() {
    if (!pendingCompareData) return;
    const { oldR, newR } = pendingCompareData;

    const overlay = document.createElement('div');
    overlay.className = 'full-compare-modal';
    overlay.innerHTML = `
    <div class="full-compare-header">
    <h3>Confronto Ricette</h3>
    <button class="btn-text" style="font-size:1.5rem;" onclick="this.closest('.full-compare-modal').remove()">&times;</button>
    </div>
    <div class="compare-split">
    <div class="compare-side old-side">
    <div class="side-tag">RICETTA ATTUALMENTE SALVATA</div>
    ${formatRecipeFull(oldR)}
    </div>
    <div class="compare-side new-side">
    <div class="side-tag">RICETTA NUOVA DEL FILE CARICATO</div>
    ${formatRecipeFull(newR)}
    </div>
    </div>
    <div style="padding:20px; text-align:center;">
    <button class="btn-secondary" onclick="this.closest('.full-compare-modal').remove()">Chiudi e torna alla scelta</button>
    </div>
    `;
    document.body.appendChild(overlay);
}

function openManualPreview(r) {
    const html = formatRecipeFull(r);
    const overlay = document.createElement('div');
    overlay.className = 'custom-dialog-overlay';
    overlay.style.zIndex = '3000';

    overlay.innerHTML = `
    <div class="custom-dialog-box" style="text-align:left; max-width:500px; width:95%; max-height:80vh; overflow-y:auto;">
    ${html}
    <div class="dialog-buttons">
    <button class="btn-primary" id="close-preview-btn">Chiudi</button>
    </div>
    </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('close-preview-btn').onclick = () => {
        document.body.removeChild(overlay);
    };
}

function showRecipeSelectionDialog(recipes, title, confirmLabel) {
    return new Promise((resolve) => {
        const container = document.getElementById('custom-dialog-container');
        const sorted = [...recipes].sort((a,b) => a.name.localeCompare(b.name));

        let listHtml = `<div class="manual-import-list">`;
        sorted.forEach((r, idx) => {
            listHtml += `
            <div class="import-row">
            <label class="import-check-area">
            <input type="checkbox" class="import-cb" value="${idx}">
            <span>${r.name}</span>
            </label>
            <button class="btn-icon small" title="Leggi" id="preview-${idx}">📖</button>
            </div>`;
        });
        listHtml += `</div>`;

        container.innerHTML = `
        <div class="custom-dialog-overlay">
        <div class="custom-dialog-box dialog-wide">
        <h3>${title}</h3>
        <div class="select-all-bar">
        <button class="btn-small btn-secondary" id="toggle-all-btn">Seleziona/Deseleziona Tutto</button>
        <span style="font-size:0.8rem; color:var(--text-light);">${sorted.length} ricette</span>
        </div>
        ${listHtml}
        <div class="dialog-buttons">
        <button class="btn-secondary" id="sel-cancel">Annulla</button>
        <button class="btn-primary" id="sel-confirm">${confirmLabel}</button>
        </div>
        </div>
        </div>`;

        sorted.forEach((r, idx) => {
            document.getElementById(`preview-${idx}`).onclick = (e) => {
                e.stopPropagation();
                openManualPreview(r);
            };
        });

        document.getElementById('toggle-all-btn').onclick = () => {
            const cbs = document.querySelectorAll('.import-cb');
            const allChecked = Array.from(cbs).every(cb => cb.checked);
            cbs.forEach(cb => cb.checked = !allChecked);
        };

        document.getElementById('sel-cancel').onclick = () => {
            container.innerHTML = '';
            resolve(null);
        };

        document.getElementById('sel-confirm').onclick = () => {
            const checkboxes = document.querySelectorAll('.import-cb:checked');
            const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.value));
            const selectedRecipes = selectedIndices.map(i => sorted[i]);
            container.innerHTML = '';
            resolve(selectedRecipes);
        };
    });
}

async function showManualImportSelector(recipes) {
    return showRecipeSelectionDialog(recipes, "Importa Manuale", "Importa Selezionate");
}

async function askConflictResolution(oldR, newR) {
    pendingCompareData = { oldR, newR };
    const html = `<p>Trovato conflitto per <b>${newR.name}</b><br><small>-Simile a: </small><b>${oldR.name}</b><br>Vuoi vedere le differenze?</p>`;
    return await showCustomDialog("Conflitto", html, 'conflict');
}

async function importJSON(el) {
    const file = el.files[0]; if (!file) return;
    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            let importedRecipes = JSON.parse(e.target.result);
            if (!Array.isArray(importedRecipes)) throw new Error("Formato non valido");

            const dbRes = await apiCall('/recipes');
            const dbRecipes = await dbRes.json();

            const choice = await showCustomDialog(
                "Modalità Importazione",
                `<p>Hai caricato <b>${importedRecipes.length}</b> ricette.<br>Come vuoi procedere?</p>`,
                'import_choice'
            );

            if (choice === false) {
                el.value = '';
                return;
            }

            if (choice === 'no') {
                if (await showConfirm("⚠️ ATTENZIONE: Questo cancellerà TUTTE le ricette esistenti. Sicuro?")) {
                    const res = await apiCall('/import-json', 'POST', { recipes: importedRecipes, clear: true });
                    const dat = await res.json();
                    await showAlert(`Importazione Completa!<br>Inserite: ${dat.count}`);
                    recipesCache = []; loadRecipes();
                }
                el.value = '';
                document.getElementById('backup-modal').classList.add('hidden');
                return;
            }

            let recipesToProcess = importedRecipes;

            if (choice === 'manual') {
                const selected = await showManualImportSelector(importedRecipes);
                if (!selected || selected.length === 0) {
                    el.value = ''; return;
                }
                recipesToProcess = selected;
            }

            let toInsert = [];
            let updatedCount = 0;
            let skippedCount = 0;

            for (let newR of recipesToProcess) {
                let match = null;
                for (let dbR of dbRecipes) {
                    if (isFuzzyMatch(dbR.name, newR.name)) {
                        match = dbR;
                        break;
                    }
                }

                if (match) {
                    const decision = await askConflictResolution(match, newR);

                    if (decision === 'yes') {
                        await apiCall(`/recipes/${match.id}`, 'PUT', newR);
                        updatedCount++;
                    } else if (decision === 'keep_both') {
                        toInsert.push(newR);
                    } else {
                        skippedCount++;
                    }
                } else {
                    toInsert.push(newR);
                }
            }

            let insertedCount = 0;
            if (toInsert.length > 0) {
                const res = await apiCall('/import-json', 'POST', { recipes: toInsert, clear: false });
                const dat = await res.json();
                insertedCount = dat.count;
            }

            await showAlert(`Importazione Completa!<br>Nuove aggiunte: ${insertedCount}<br>Aggiornate: ${updatedCount}<br>Ignorate: ${skippedCount}`);
            recipesCache = []; loadRecipes();

        } catch (err) {
            console.error(err);
            await showAlert("Errore durante la lettura del file o JSON non valido.");
        }
        el.value = ''; document.getElementById('backup-modal').classList.add('hidden');
    };
    reader.readAsText(file);
}
