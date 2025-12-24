<?php
/**
 * Family Menu Backend - PHP Version
 * Replaces existing Node.js Express server
 */

// CONFIGURAZIONE
define('SECRET_CODE', '1234');
define('DB_FILE', __DIR__ . '/data/recipes.db');
define('DATA_DIR', __DIR__ . '/data');

// SETUP INIZIALE
if (!file_exists(DATA_DIR)) {
    mkdir(DATA_DIR, 0777, true);
}

// CORS & HEADERS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json; charset=UTF-8");

// Gestione Preflight (OPTIONS)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// CONNESSIONE DATABASE (PDO)
try {
    $pdo = new PDO('sqlite:' . DB_FILE);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    // Creazione Tabelle
    $pdo->exec("CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        servings INTEGER,
        ingredients TEXT,
        difficulty INTEGER DEFAULT 1,
        procedure TEXT DEFAULT ''
    )");

    $pdo->exec("CREATE TABLE IF NOT EXISTS menu_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT
    )");
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error: ' . $e->getMessage()]);
    exit();
}

// --- HELPER FUNCTIONS ---

function getJsonInput() {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

function sendJson($data) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK);
    exit();
}

function sendError($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit();
}

function checkAuth() {
    $headers = getallheaders();
    
    // MODIFICA QUI: Cerchiamo il token in più posizioni
    $auth = $headers['Authorization'] ?? 
            $headers['authorization'] ?? 
            $headers['X-Auth-Token'] ??      // Controllo header custom
            $headers['x-auth-token'] ??      // Controllo minuscolo
            '';

    // Il controllo rimane lo stesso, perché il contenuto è sempre "Bearer CODE"
    if ($auth !== 'Bearer ' . SECRET_CODE) {
        sendError("Non autorizzato", 401);
    }
}

// Funzione helper per ottenere header su server che non supportano getallheaders() (es. Nginx FPM a volte)
if (!function_exists('getallheaders')) {
    function getallheaders() {
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (substr($name, 0, 5) == 'HTTP_') {
                $headers[str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))))] = $value;
            }
        }
        return $headers;
    }
}

function toTitleCase($str) {
    return mb_convert_case($str, MB_CASE_TITLE, "UTF-8");
}

function getWeightedRandom($items, &$usedIds) {
    $pool = array_filter($items, function($r) use ($usedIds) {
        return !in_array($r['id'], $usedIds);
    });
    
    // Reset pool se vuoto
    if (empty($pool)) {
        $pool = $items;
    }
    if (empty($pool)) return null;

    $weightedPool = [];
    foreach ($pool as $item) {
        $weight = max(1, 6 - ($item['difficulty'] ?? 1));
        for ($k = 0; $k < $weight; $k++) {
            $weightedPool[] = $item;
        }
    }

    $selected = $weightedPool[array_rand($weightedPool)];
    if ($selected) {
        $usedIds[] = $selected['id'];
    }
    return $selected;
}

function hydrateMenuWithLiveRecipes($menuState, $allRecipes) {
    if (!$menuState) return null;
    $recipeMap = [];
    foreach ($allRecipes as $r) $recipeMap[$r['id']] = $r;

    $refreshItem = function($item) use ($recipeMap, &$refreshItem) {
        if (!$item) return $item;
        
        // Se è un array di items (pasto composto)
        if (isset($item['items']) && is_array($item['items'])) {
            $item['items'] = array_map($refreshItem, $item['items']);
            return $item;
        }

        // Se è una ricetta singola
        if (isset($item['id']) && isset($recipeMap[$item['id']])) {
            $live = $recipeMap[$item['id']];
            return array_merge($item, [
                'name' => $live['name'],
                'type' => $live['type'],
                'servings' => $live['servings'],
                'ingredients' => json_decode($live['ingredients'], true),
                'difficulty' => $live['difficulty'],
                'procedure' => $live['procedure']
            ]);
        }
        return $item;
    };

    if (isset($menuState['menu'])) {
        foreach ($menuState['menu'] as &$day) {
            $day['lunch'] = $refreshItem($day['lunch'] ?? null);
            $day['dinner'] = $refreshItem($day['dinner'] ?? null);
        }
    }
    if (isset($menuState['extraMeals'])) {
        $menuState['extraMeals'] = array_map($refreshItem, $menuState['extraMeals']);
    }
    if (isset($menuState['dessert'])) {
        $menuState['dessert'] = $refreshItem($menuState['dessert']);
    }

    return $menuState;
}

// Logica Lista Spesa
function updateShoppingItem(&$list, $name, $qtyRaw, $ratio, $context, $recipeName) {
    $key = mb_strtolower(trim($name));
    $qtyNum = (float)str_replace(',', '.', (string)$qtyRaw);
    $calculatedQty = ($qtyNum == 0 && $qtyRaw !== '0') ? 0 : ($qtyNum * $ratio); // Gestione q.b.
    $isQb = ($qtyNum == 0 && $qtyRaw !== '0');

    if (!isset($list[$key])) {
        $list[$key] = [
            'total' => 0,
            'isQb' => false,
            'originalName' => $name,
            'usages' => []
        ];
    }

    $list[$key]['usages'][] = [
        'context' => $context,
        'recipe' => $recipeName,
        'qty' => $isQb ? "q.b." : $calculatedQty
    ];

    if ($isQb) {
        $list[$key]['isQb'] = true;
    } else {
        $list[$key]['total'] += $calculatedQty;
    }
}

function processRecipeForShopping($recipeOrMeal, &$listCombinedRaw, $people, $contextLabel) {
    if (!$recipeOrMeal) return;

    $items = [];
    if (isset($recipeOrMeal['items']) && is_array($recipeOrMeal['items'])) {
        $items = $recipeOrMeal['items'];
    } else {
        $items = [$recipeOrMeal];
    }

    foreach ($items as $subItem) {
        // Logica servings: customServings del wrapper > people globale
        $itemPeople = $recipeOrMeal['customServings'] ?? $people;
        $baseServings = $subItem['servings'] ?? 2;
        $ratio = $itemPeople / $baseServings;

        $ingredients = is_string($subItem['ingredients']) ? json_decode($subItem['ingredients'], true) : $subItem['ingredients'];
        
        if (is_array($ingredients)) {
            foreach ($ingredients as $ing) {
                updateShoppingItem($listCombinedRaw, $ing['name'], $ing['quantity'], $ratio, $contextLabel, $subItem['name']);
            }
        }
    }
}

function calculateShoppingList($menu, $dessert, $extraMeals, $people, $dessertPeople, $oldState = []) {
    $oldMain = $oldState['shoppingList']['main'] ?? [];
    $overrides = $oldState['shoppingOverrides'] ?? [];
    $extras = $oldState['shoppingExtras'] ?? [];

    $listCombinedRaw = [];

    foreach ($menu as $day) {
        foreach (['lunch', 'dinner'] as $slot) {
            $context = "Giorno {$day['day']} (" . ($slot === 'lunch' ? 'Pranzo' : 'Cena') . ")";
            processRecipeForShopping($day[$slot] ?? null, $listCombinedRaw, $people, $context);
        }
    }

    if (is_array($extraMeals)) {
        foreach ($extraMeals as $meal) {
            processRecipeForShopping($meal, $listCombinedRaw, $meal['customServings'] ?? $people, "Extra");
        }
    }

    if ($dessert) {
        $dRatio = ($dessertPeople ?: $people) / ($dessert['servings'] ?? 1);
        $ingredients = is_string($dessert['ingredients']) ? json_decode($dessert['ingredients'], true) : $dessert['ingredients'];
        if (is_array($ingredients)) {
            foreach ($ingredients as $ing) {
                updateShoppingItem($listCombinedRaw, $ing['name'], $ing['quantity'], $dRatio, "Dolce", $dessert['name']);
            }
        }
    }

    $finalMain = [];
    ksort($listCombinedRaw);
    
    foreach ($listCombinedRaw as $key => $item) {
        $titleKey = toTitleCase($item['originalName']);
        $overrideKey = "main_" . $titleKey;
        $hasOverride = array_key_exists($overrideKey, $overrides);

        $displayQty = 0;
        if ($hasOverride) {
            $displayQty = $overrides[$overrideKey];
        } else {
            $displayQty = $item['isQb'] ? "q.b." : ceil($item['total']);
        }

        $isChecked = false;
        if (isset($oldMain[$titleKey]) && isset($oldMain[$titleKey]['checked']) && $oldMain[$titleKey]['checked']) {
            // Logica per mantenere il check
            if ($hasOverride || $item['isQb']) {
                $isChecked = true;
            } else {
                $oldQtyNum = (float)$oldMain[$titleKey]['qty'];
                // Se la nuova quantità è minore o uguale alla vecchia (che era checkata), tieni il check
                if (ceil($item['total']) <= $oldQtyNum) {
                    $isChecked = true;
                }
            }
        }

        $finalMain[$titleKey] = [
            'qty' => $displayQty,
            'checked' => $isChecked,
            'isModified' => $hasOverride,
            'usages' => $item['usages']
        ];
    }

    return [
        'shoppingList' => ['main' => $finalMain],
        'shoppingOverrides' => $overrides,
        'shoppingExtras' => $extras
    ];
}

function saveState($pdo, $stateData) {
    // Ricalcola la spesa prima di salvare
    $recalc = calculateShoppingList(
        $stateData['menu'],
        $stateData['dessert'],
        $stateData['extraMeals'],
        $stateData['people'],
        $stateData['dessertPeople'],
        $stateData
    );
    $stateData['shoppingList'] = $recalc['shoppingList'];
    $stateData['shoppingOverrides'] = $recalc['shoppingOverrides'];
    $stateData['shoppingExtras'] = $recalc['shoppingExtras'];

    $stmt = $pdo->prepare("INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)");
    $stmt->execute([json_encode($stateData)]);
    return $stateData;
}


// --- ROUTING ---

// Parsing URL
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Rimuovi prefisso folder se lo script è in una sottocartella (opzionale, ma utile)
// Assumiamo che le chiamate arrivino a /api/...
// Se usi api.php come entry point diretto, il routing è interno.

// Estrai l'endpoint (es: /api/recipes -> /recipes)
// Nota: qui assumiamo che il client chiami 'api.php?endpoint=/recipes' O che tu abbia RewriteRule.
// Per semplicità, gestiamo un sistema "path info" manuale.
// Se la richiesta è `api.php/recipes`, PATH_INFO è `/recipes`.

$pathInfo = $_SERVER['PATH_INFO'] ?? '/';
if ($pathInfo === '/') {
    // Fallback per query param se PATH_INFO non funziona
    $pathInfo = $_GET['endpoint'] ?? '/';
}

// ROUTER
switch ($pathInfo) {

    // LOGIN
    case '/login':
        if ($method !== 'POST') sendError('Method not allowed', 405);
        $input = getJsonInput();
        if (($input['code'] ?? '') === SECRET_CODE) {
            sendJson(['token' => SECRET_CODE]);
        } else {
            sendError("Codice errato", 401);
        }
        break;

    // SFONDI
    case (preg_match('#^/background/(.+)$#', $pathInfo, $matches) ? $pathInfo : false):
        $theme = trim($matches[1], "/ \t\n\r\0\x0B");
        
        $bgDir = __DIR__ . '/bg';
        $filename = null;
        
        if (is_dir($bgDir)) {
            $files = @scandir($bgDir); 
            if ($files !== false) {
                $candidates = [];
                $pattern = "/^" . preg_quote($theme, '/') . "\..+\.(png|jpg|jpeg|webp)$/i";
                
                foreach ($files as $f) {
                    if ($f === '.' || $f === '..') continue;
                    if (preg_match($pattern, $f)) {
                        $candidates[] = $f;
                    }
                }
                
                if (!empty($candidates)) {
                    $randKey = array_rand($candidates);
                    $filename = $candidates[$randKey];
                }
            }
        }
        sendJson(['filename' => $filename]);
        break;

    // RICETTE (CRUD)
    case '/recipes':
        checkAuth();
        if ($method === 'GET') {
            $stmt = $pdo->query("SELECT * FROM recipes ORDER BY name ASC");
            $rows = $stmt->fetchAll();
            // Decodifica JSON ingredienti
            foreach ($rows as &$r) {
                $r['ingredients'] = json_decode($r['ingredients'], true);
            }
            sendJson($rows);
        }
        elseif ($method === 'POST') {
            $in = getJsonInput();
            $stmt = $pdo->prepare("INSERT INTO recipes (name, type, servings, ingredients, difficulty, procedure) VALUES (?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $in['name'], $in['type'], $in['servings'], 
                json_encode($in['ingredients']), 
                $in['difficulty'] ?? 1, $in['procedure'] ?? ''
            ]);
            sendJson(['id' => $pdo->lastInsertId()]);
        }
        break;

    // RICETTA SINGOLA (PUT/DELETE)
    case (preg_match('#^/recipes/(\d+)$#', $pathInfo, $matches) ? true : false):
        checkAuth();
        $id = $matches[1];
        if ($method === 'PUT') {
            $in = getJsonInput();
            $stmt = $pdo->prepare("UPDATE recipes SET name=?, type=?, servings=?, ingredients=?, difficulty=?, procedure=? WHERE id=?");
            $stmt->execute([
                $in['name'], $in['type'], $in['servings'], 
                json_encode($in['ingredients']), 
                $in['difficulty'] ?? 1, $in['procedure'] ?? '',
                $id
            ]);
            sendJson(['message' => 'OK']);
        }
        elseif ($method === 'DELETE') {
            $stmt = $pdo->prepare("DELETE FROM recipes WHERE id=?");
            $stmt->execute([$id]);
            sendJson(['message' => 'OK']);
        }
        break;

    // EXPORT JSON
    case '/export-json':
        checkAuth();
        if ($method !== 'POST') sendError('Method not allowed', 405);
        $in = getJsonInput();
        $ids = $in['ids'] ?? [];
        
        $sql = "SELECT name, type, servings, ingredients, difficulty, procedure FROM recipes";
        $params = [];
        if (!empty($ids)) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $sql .= " WHERE id IN ($placeholders)";
            $params = $ids;
        }
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['ingredients'] = json_decode($r['ingredients'], true);
        }
        
        header('Content-Disposition: attachment; filename=backup.json');
        sendJson($rows);
        break;

    // IMPORT JSON
    case '/import-json':
        checkAuth();
        if ($method !== 'POST') sendError('Method not allowed', 405);
        $in = getJsonInput();
        $recipes = $in['recipes'] ?? [];
        $clear = $in['clear'] ?? false;

        $pdo->beginTransaction();
        try {
            if ($clear) {
                $pdo->exec("DELETE FROM recipes");
                $pdo->exec("DELETE FROM sqlite_sequence WHERE name='recipes'");
            }
            $stmt = $pdo->prepare("INSERT INTO recipes (name, type, servings, ingredients, difficulty, procedure) VALUES (?, ?, ?, ?, ?, ?)");
            foreach ($recipes as $r) {
                $stmt->execute([
                    $r['name'], $r['type'], $r['servings'] ?? 2,
                    json_encode($r['ingredients']),
                    $r['difficulty'] ?? 1, $r['procedure'] ?? ''
                ]);
            }
            $pdo->commit();
            sendJson(['message' => 'Import OK', 'count' => count($recipes)]);
        } catch (Exception $e) {
            $pdo->rollBack();
            sendError($e->getMessage(), 500);
        }
        break;

    // GENERA MENU
    case '/generate-menu':
        checkAuth();
        if ($method !== 'POST') sendError('Method not allowed', 405);
        $in = getJsonInput();
        $people = $in['people'];

        // Recupera stato precedente per preservare extras
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $rowState = $stmt->fetch();
        $preservedExtras = [];
        if ($rowState) {
            $oldData = json_decode($rowState['data'], true);
            if (isset($oldData['shoppingExtras'])) $preservedExtras = $oldData['shoppingExtras'];
        }

        // Recupera tutte le ricette
        $stmt = $pdo->query("SELECT * FROM recipes");
        $allRecipes = $stmt->fetchAll();
        // Decodifica JSON
        foreach($allRecipes as &$r) $r['ingredients'] = json_decode($r['ingredients'], true);

        if (count($allRecipes) < 2) sendError("Poche ricette nel DB!");

        // Filtri
        $primiSemplici = array_filter($allRecipes, fn($r) => $r['type'] === 'primo');
        $primiCompleti = array_filter($allRecipes, fn($r) => $r['type'] === 'primo_completo');
        $sughi = array_filter($allRecipes, fn($r) => $r['type'] === 'sugo');
        $secondi = array_filter($allRecipes, fn($r) => $r['type'] === 'secondo');
        $contorni = array_filter($allRecipes, fn($r) => $r['type'] === 'contorno');
        $secondiCompleti = array_filter($allRecipes, fn($r) => $r['type'] === 'secondo_completo');
        $dolci = array_filter($allRecipes, fn($r) => $r['type'] === 'dolce');

        $weekMenu = [];
        $usedIds = [];

        for ($i = 0; $i < 7; $i++) {
            $dayMenu = ['day' => $i + 1, 'lunch' => null, 'dinner' => null];

            // PRANZO
            $useCompleteLunch = ((rand(0,100)/100 > 0.6) && !empty($primiCompleti)) || empty($primiSemplici);
            if ($useCompleteLunch) {
                $dayMenu['lunch'] = getWeightedRandom($primiCompleti, $usedIds);
            } else {
                $p = getWeightedRandom($primiSemplici, $usedIds);
                $s = getWeightedRandom($sughi, $usedIds);
                if ($p) {
                    if ($s) {
                        $dayMenu['lunch'] = [
                            'isComposite' => true,
                            'name' => $p['name'] . " al " . $s['name'],
                            'items' => [$p, $s],
                            'difficulty' => max($p['difficulty'], $s['difficulty'])
                        ];
                    } else {
                        $dayMenu['lunch'] = $p;
                    }
                }
            }

            // CENA
            $useCompleteDinner = ((rand(0,100)/100 > 0.5) && !empty($secondiCompleti)) || empty($secondi);
            if ($useCompleteDinner && !empty($secondiCompleti)) {
                $dayMenu['dinner'] = getWeightedRandom($secondiCompleti, $usedIds);
            } else {
                $sec = getWeightedRandom($secondi, $usedIds);
                $cont = getWeightedRandom($contorni, $usedIds);
                if ($sec) {
                    if ($cont) {
                        $dayMenu['dinner'] = [
                            'isComposite' => true,
                            'name' => $sec['name'] . " + " . $cont['name'],
                            'items' => [$sec, $cont],
                            'difficulty' => max($sec['difficulty'], $cont['difficulty'])
                        ];
                    } else {
                        $dayMenu['dinner'] = $sec;
                    }
                }
            }
            $weekMenu[] = $dayMenu;
        }

        $selectedDessert = getWeightedRandom($dolci, $usedIds);
        $tempState = ['shoppingExtras' => $preservedExtras, 'shoppingOverrides' => []];
        
        $calculated = calculateShoppingList($weekMenu, $selectedDessert, [], $people, $people, $tempState);

        $stateData = [
            'menu' => $weekMenu,
            'extraMeals' => [],
            'shoppingList' => $calculated['shoppingList'],
            'shoppingOverrides' => $calculated['shoppingOverrides'],
            'shoppingExtras' => $calculated['shoppingExtras'],
            'dessert' => $selectedDessert,
            'people' => $people,
            'dessertPeople' => $people
        ];

        // Salva
        $stmt = $pdo->prepare("INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)");
        $stmt->execute([json_encode($stateData)]);
        sendJson($stateData);
        break;

    // CARICA ULTIMO MENU
    case '/last-menu':
        checkAuth();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        if (!$row) sendJson(null);
        
        $storedMenu = json_decode($row['data'], true);
        
        // Hydration
        $stmt = $pdo->query("SELECT * FROM recipes");
        $allRecipes = $stmt->fetchAll();
        $storedMenu = hydrateMenuWithLiveRecipes($storedMenu, $allRecipes);
        
        sendJson($storedMenu);
        break;

    // TOGGLE SPESA
    case '/toggle-shopping-item':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        if (!$row) sendError("No menu");
        
        $s = json_decode($row['data'], true);
        if ($in['isExtra']) {
            foreach ($s['shoppingExtras'] as &$e) {
                if ($e['name'] === $in['item']) $e['checked'] = !$e['checked'];
            }
        } else {
            if (isset($s['shoppingList'][$in['category']][$in['item']])) {
                $s['shoppingList'][$in['category']][$in['item']]['checked'] = !$s['shoppingList'][$in['category']][$in['item']]['checked'];
            }
        }
        
        $stmt = $pdo->prepare("INSERT OR REPLACE INTO menu_state (id, data) VALUES (1, ?)");
        $stmt->execute([json_encode($s)]);
        sendJson(['success' => true]);
        break;

    // UPDATE QTY SPESA
    case '/update-shopping-qty':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        if (!$row) sendError("No menu");
        $s = json_decode($row['data'], true);
        
        $s['shoppingOverrides'][$in['category'] . '_' . $in['item']] = $in['newQty'];
        sendJson(saveState($pdo, $s));
        break;

    // ADD EXTRA SPESA
    case '/add-shopping-extra':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        if (!$row) sendError("No menu");
        $s = json_decode($row['data'], true);
        
        $s['shoppingExtras'][] = ['id' => time() * 1000, 'name' => toTitleCase($in['name']), 'qty' => $in['qty'], 'checked' => false];
        sendJson(saveState($pdo, $s));
        break;
    
    // REMOVE EXTRA SPESA
    case '/remove-shopping-extra':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        if (!$row) sendError("No menu");
        $s = json_decode($row['data'], true);
        
        $s['shoppingExtras'] = array_values(array_filter($s['shoppingExtras'], fn($e) => $e['id'] != $in['id']));
        sendJson(saveState($pdo, $s));
        break;

    // CLEAR EXTRAS
    case '/clear-shopping-extras':
        checkAuth();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        if (!$row) sendError("No menu");
        $s = json_decode($row['data'], true);
        $s['shoppingExtras'] = [];
        sendJson(saveState($pdo, $s));
        break;

    // UPDATE SERVINGS
    case '/update-meal-servings':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        $s = json_decode($row['data'], true);
        
        if (isset($in['extraId']) && $in['extraId']) {
            foreach ($s['extraMeals'] as &$m) {
                if (($m['uniqueId'] ?? 0) == $in['extraId']) {
                    $m['customServings'] = (int)$in['servings'];
                    break;
                }
            }
        } else {
            $dayIdx = $in['day'] - 1;
            if (isset($s['menu'][$dayIdx][$in['type']])) {
                $s['menu'][$dayIdx][$in['type']]['customServings'] = (int)$in['servings'];
            }
        }
        sendJson(saveState($pdo, $s));
        break;

    // REGENERATE MEAL (Singolo)
    case '/regenerate-meal':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        $s = json_decode($row['data'], true);

        // Fetch recipes
        $stmt = $pdo->query("SELECT * FROM recipes");
        $allRecipes = $stmt->fetchAll();
        foreach($allRecipes as &$r) $r['ingredients'] = json_decode($r['ingredients'], true);
        
        // Logica semplificata di rigenerazione (simile a generate-menu)
        // Nota: Per brevità qui replico la logica base, idealmente estrarre in funzione
        $newMeal = null;
        $dummyUsed = []; // Non ci preoccupiamo dei duplicati nella rigenerazione singola per ora

        if ($in['type'] === 'lunch') {
            $pool = array_filter($allRecipes, fn($r) => $r['type'] === 'primo');
            $newMeal = getWeightedRandom($pool, $dummyUsed);
        } else {
            $pool = array_filter($allRecipes, fn($r) => $r['type'] === 'secondo');
            $newMeal = getWeightedRandom($pool, $dummyUsed);
        }

        if ($newMeal) {
            // Mantieni custom servings se c'erano
            $oldServings = $s['menu'][$in['day']-1][$in['type']]['customServings'] ?? null;
            if ($oldServings) $newMeal['customServings'] = $oldServings;
            $s['menu'][$in['day']-1][$in['type']] = $newMeal;
        }

        sendJson(saveState($pdo, $s));
        break;

    // UPDATE DESSERT PEOPLE
    case '/update-dessert-servings':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        $s = json_decode($row['data'], true);
        $s['dessertPeople'] = (int)$in['servings'];
        sendJson(saveState($pdo, $s));
        break;
    
    // REGENERATE DESSERT
    case '/regenerate-dessert':
        checkAuth();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        $s = json_decode($row['data'], true);
        
        $stmt = $pdo->query("SELECT * FROM recipes WHERE type = 'dolce'");
        $dolci = $stmt->fetchAll();
        foreach($dolci as &$r) $r['ingredients'] = json_decode($r['ingredients'], true);
        
        // Evita stesso dolce
        $currentId = $s['dessert']['id'] ?? 0;
        $pool = array_filter($dolci, fn($r) => $r['id'] != $currentId);
        $dummyUsed = [];
        
        $s['dessert'] = getWeightedRandom($pool, $dummyUsed);
        if (!$s['dessertPeople']) $s['dessertPeople'] = $s['people'];
        
        sendJson(saveState($pdo, $s));
        break;

    // SET MANUAL MEAL / DESSERT
    case '/set-manual-meal':
    case '/add-manual-meal':
    case '/set-manual-dessert':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        $s = json_decode($row['data'], true);

        // Recupera Ricette
        $ids = [$in['recipeId']];
        if (isset($in['pairedRecipeId']) && $in['pairedRecipeId']) $ids[] = $in['pairedRecipeId'];
        
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("SELECT * FROM recipes WHERE id IN ($placeholders)");
        $stmt->execute($ids);
        $dbRows = $stmt->fetchAll();
        foreach($dbRows as &$r) $r['ingredients'] = json_decode($r['ingredients'], true);

        if (empty($dbRows)) sendError("Ricetta non trovata");

        // Trova oggetto
        $r1 = null; $r2 = null;
        foreach ($dbRows as $row) {
            if ($row['id'] == $in['recipeId']) $r1 = $row;
            if (isset($in['pairedRecipeId']) && $row['id'] == $in['pairedRecipeId']) $r2 = $row;
        }

        // Costruisci oggetto Pasto
        $mealObj = $r1;
        if ($r2) {
            $items = [$r1, $r2];
            // Ordine logico
            if (strpos($r1['type'], 'sugo') !== false || strpos($r1['type'], 'contorno') !== false) {
                $items = [$r2, $r1];
            }
            $sep = (strpos($items[0]['type'], 'primo') !== false) ? " al " : " + ";
            $mealObj = [
                'isComposite' => true,
                'name' => $items[0]['name'] . $sep . $items[1]['name'],
                'items' => $items,
                'difficulty' => max($r1['difficulty'], $r2['difficulty'])
            ];
        }

        if ($pathInfo === '/set-manual-dessert') {
            $s['dessert'] = $mealObj;
            if(!$s['dessertPeople']) $s['dessertPeople'] = $s['people'];
        } 
        elseif ($pathInfo === '/add-manual-meal') {
            $mealObj['uniqueId'] = time() * 1000;
            $mealObj['customServings'] = $s['people'];
            $s['extraMeals'][] = $mealObj;
        }
        else {
            // Set Manual Meal standard
            if (isset($in['extraId']) && $in['extraId']) {
                foreach ($s['extraMeals'] as &$m) {
                    if (($m['uniqueId'] ?? 0) == $in['extraId']) {
                        $mealObj['uniqueId'] = $in['extraId'];
                        $mealObj['customServings'] = $m['customServings'];
                        $m = $mealObj;
                        break;
                    }
                }
            } else {
                $dayIdx = $in['day'] - 1;
                $old = $s['menu'][$dayIdx][$in['type']] ?? null;
                if ($old && isset($old['customServings'])) {
                    $mealObj['customServings'] = $old['customServings'];
                }
                $s['menu'][$dayIdx][$in['type']] = $mealObj;
            }
        }
        
        sendJson(saveState($pdo, $s));
        break;
    
    // REMOVE MANUAL EXTRA
    case '/remove-manual-meal':
        checkAuth();
        $in = getJsonInput();
        $stmt = $pdo->query("SELECT data FROM menu_state WHERE id = 1");
        $row = $stmt->fetch();
        $s = json_decode($row['data'], true);
        
        $s['extraMeals'] = array_values(array_filter($s['extraMeals'], fn($m) => ($m['uniqueId'] ?? 0) != $in['uniqueId']));
        sendJson(saveState($pdo, $s));
        break;

    default:
        sendError("Endpoint non trovato: $pathInfo", 404);
        break;
}