// Global State
let materials = [];
let machines = [];
let globalSettings = {};
let selectedPublicMaterialId = 'pla';
let activeStlFile = null;

// Three.js Variables
let scene, camera, renderer, controls, stlMesh;
let animationFrameId;

// DOM Elements
const navButtons = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    fetchConfig();
    setupPublicEstimator();
    setupAdminCalculator();
    setupSettingsPanel();
    setupDeveloperPortal();
    setupSuperAdminPortal();
    initThreeJS();
    setupConfirmModalListeners();
    setupBulkDelete();
});

// 1. Navigation Setup
function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.tab-content');
    
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            navBtns.forEach(b => b.classList.remove('active'));
            sections.forEach(tc => tc.classList.remove('active'));
            
            btn.classList.add('active');
            const targetSec = document.getElementById(targetTab);
            if (targetSec) targetSec.classList.add('active');
            
            // Handle Three.js canvas resizing when tab becomes visible
            if (targetTab === 'public-tab' && renderer && camera) {
                resizeThreeJS();
            }
            
            if (targetTab === 'developer-tab') {
                loadDeveloperPortal();
            } else if (targetTab === 'superadmin-tab') {
                loadSuperAdminPortal();
            }
        });
    });

    // Developer Dashboard Sub-tabs
    const dbTabBtns = document.querySelectorAll('[data-db-tab]');
    dbTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dbTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const targetId = btn.getAttribute('data-db-tab');
            const dbSections = document.querySelectorAll('.dashboard-sections > div');
            dbSections.forEach(s => {
                if (s.id.startsWith('db-')) {
                    s.classList.remove('active');
                }
            });
            
            const targetSec = document.getElementById(targetId);
            if (targetSec) targetSec.classList.add('active');
        });
    });
    
    // Super Admin Dashboard Sub-tabs
    const saTabBtns = document.querySelectorAll('[data-sa-tab]');
    saTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            saTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const targetId = btn.getAttribute('data-sa-tab');
            const saSections = document.querySelectorAll('.dashboard-sections > div');
            saSections.forEach(s => {
                if (s.id.startsWith('sa-')) {
                    s.classList.remove('active');
                }
            });
            
            const targetSec = document.getElementById(targetId);
            if (targetSec) targetSec.classList.add('active');
        });
    });
}

// 2. Fetch Configurations from API
async function fetchConfig() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        
        materials = data.materials;
        machines = data.machines;
        globalSettings = data.global_settings;
        
        renderPublicMaterialSelector();
        populateAdminSelects();
        populateSettingsFields(data);
    } catch (error) {
        console.error('Error fetching system configurations:', error);
    }
}

// 3. Public Estimator Logic
function renderPublicMaterialSelector() {
    const grid = document.getElementById('public-material-grid');
    grid.innerHTML = '';
    
    materials.forEach(mat => {
        const card = document.createElement('div');
        card.className = `material-card ${mat.id === selectedPublicMaterialId ? 'active' : ''}`;
        card.setAttribute('data-id', mat.id);
        
        card.innerHTML = `
            <span class="material-name">${mat.name}</span>
            <span class="material-desc">${mat.price_per_kg} TND/kg</span>
        `;
        
        card.addEventListener('click', () => {
            document.querySelectorAll('.material-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectedPublicMaterialId = mat.id;
            
            // Sync with confirm dropdown
            const confirmMatSelect = document.getElementById('confirm-material-select');
            if (confirmMatSelect) {
                confirmMatSelect.value = mat.id;
            }
            
            // Update 3D model color to reflect material change
            updateMeshMaterialColor(mat.id);
        });
        
        grid.appendChild(card);
    });
}

function setupPublicEstimator() {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('stl-file-input');
    const removeFileBtn = document.getElementById('remove-file-btn');
    const calcBtn = document.getElementById('public-calculate-btn');
    
    // Drag and drop events
    uploadZone.addEventListener('click', () => fileInput.click());
    
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });
    
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleStlSelection(e.dataTransfer.files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleStlSelection(e.target.files[0]);
        }
    });
    
    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', () => resetPublicEstimator());
    }
    
    // Calculate button (now on left panel — shown after successful scan)
    if (calcBtn) {
        calcBtn.addEventListener('click', () => {
            if (!activeStlFile) return;
            triggerEstimation(activeStlFile);
        });
    }
}

function handleStlSelection(file) {
    if (!file.name.toLowerCase().endsWith('.stl')) {
        showToast('Please select a valid STL file.', 'error');
        return;
    }
    
    activeStlFile = file;
    
    // Show progress card
    const progressContainer = document.getElementById('upload-progress-container');
    const filenameSpan = document.getElementById('uploaded-filename');
    const progressBar = document.getElementById('upload-progress-bar');
    const statusText = document.getElementById('upload-status-text');
    
    progressContainer.classList.remove('hidden');
    filenameSpan.innerHTML = `<i class="fa-solid fa-file-invoice"></i> ${file.name}`;
    progressBar.style.width = '20%';
    statusText.innerText = 'Reading file client-side...';
    
    // Load and render STL in 3D
    const reader = new FileReader();
    reader.onload = function (e) {
        progressBar.style.width = '40%';
        statusText.innerText = 'Parsing 3D geometry...';
        loadStlInViewer(e.target.result);
    };
    reader.readAsArrayBuffer(file);
    
    // Trigger Server-side scan
    triggerStlScan(file);
}

function triggerStlScan(file) {
    const progressBar = document.getElementById('upload-progress-bar');
    const statusText = document.getElementById('upload-status-text');
    
    progressBar.style.width = '60%';
    statusText.innerText = 'Running server mesh scan...';
    
    const formData = new FormData();
    formData.append('file', file);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/estimate/scan', true);
    
    xhr.onload = function () {
        let detail = 'Failed to scan file.';
        let res = null;
        try {
            res = JSON.parse(xhr.responseText);
            detail = res.detail || detail;
        } catch (e) {}
        
        if (xhr.status === 200) {
            // Keep progress bar in a "Ready" state — don't hide it
            progressBar.style.width = '100%';
            progressBar.style.background = 'linear-gradient(90deg, var(--success), #34d399)';
            statusText.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success)"></i> Ready — click Calculate on the left';
            
            // Hide dropzone, keep progress bar visible
            document.getElementById('upload-zone').classList.add('hidden');
            
            // Show read-only scan stats on the right
            const confirmPanel = document.getElementById('public-upload-confirm');
            confirmPanel.classList.remove('hidden');
            document.getElementById('confirm-filename').innerText = file.name;
            document.getElementById('confirm-volume').innerText = res.volume_cm3 + ' cm³';
            document.getElementById('confirm-watertight').innerHTML = res.is_watertight ? 
                '<span style="color: var(--success);"><i class="fa-solid fa-circle-check"></i> Yes</span>' : 
                '<span style="color: var(--warning);"><i class="fa-solid fa-triangle-exclamation"></i> No</span>';
            
            // Show Calculate button on the left
            const calcBtn = document.getElementById('public-calculate-btn');
            if (calcBtn) calcBtn.classList.remove('hidden');
            
        } else {
            progressBar.style.backgroundColor = 'var(--error)';
            statusText.innerText = 'Error: ' + detail;
            showToast(detail, 'error');
        }
    };
    
    xhr.onerror = function () {
        progressBar.style.backgroundColor = 'var(--error)';
        statusText.innerText = 'Connection error.';
        showToast('Connection error during upload.', 'error');
    };
    
    xhr.send(formData);
}

function triggerEstimation(file) {
    // Hide the Calculate button to prevent double-click
    const calcBtn = document.getElementById('public-calculate-btn');
    if (calcBtn) calcBtn.classList.add('hidden');
    
    // Hide stats panel, show spinner on the right
    document.getElementById('public-upload-confirm').classList.add('hidden');
    document.getElementById('public-result-card').classList.add('hidden');
    const calcLoading = document.getElementById('calc-loading');
    if (calcLoading) { calcLoading.classList.remove('hidden'); calcLoading.style.display = 'flex'; }
    
    // Re-send file silently (Option B — no second progress bar shown)
    const formData = new FormData();
    formData.append('file', file);
    formData.append('material_id', selectedPublicMaterialId);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/estimate/public', true);
    
    const savedDevKey = localStorage.getItem('replica_active_dev_key');
    if (savedDevKey) {
        xhr.setRequestHeader('X-API-Key', savedDevKey);
    }
    
    xhr.onload = function () {
        // Hide spinner
        if (calcLoading) { calcLoading.classList.add('hidden'); calcLoading.style.display = 'none'; }
        
        let detail = 'Failed to estimate';
        try { detail = JSON.parse(xhr.responseText).detail || detail; } catch (e) {}
        
        if (xhr.status === 200) {
            const result = JSON.parse(xhr.responseText);
            displayPublicResults(result);
            // Show Calculate button again for recalculate
            if (calcBtn) calcBtn.classList.remove('hidden');
        } else {
            showToast(detail, 'error');
            // Restore UI so user can retry
            if (calcBtn) calcBtn.classList.remove('hidden');
            document.getElementById('public-upload-confirm').classList.remove('hidden');
        }
    };
    
    xhr.onerror = function () {
        if (calcLoading) { calcLoading.classList.add('hidden'); calcLoading.style.display = 'none'; }
        showToast('Connection error during estimation.', 'error');
        if (calcBtn) calcBtn.classList.remove('hidden');
        document.getElementById('public-upload-confirm').classList.remove('hidden');
    };
    
    xhr.send(formData);
}

function displayPublicResults(res) {
    document.getElementById('public-result-card').classList.remove('hidden');
    
    document.getElementById('est-price-range').innerText = `${res.price_min} - ${res.price_max} TND`;
    document.getElementById('est-volume').innerText = `${res.volume_cm3} cm³`;
    document.getElementById('est-weight').innerText = `${res.estimated_weight_g} g`;
    
    // Format print time in hours and minutes
    const hours = Math.floor(res.estimated_time_mins / 60);
    const mins = res.estimated_time_mins % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}mins`;
    document.getElementById('est-time').innerText = timeStr;
    
    document.getElementById('est-machine').innerText = res.machine;
}

function resetPublicEstimator() {
    activeStlFile = null;
    document.getElementById('stl-file-input').value = '';
    
    // Reset progress bar style
    const progressBar = document.getElementById('upload-progress-bar');
    if (progressBar) { progressBar.style.width = '0%'; progressBar.style.background = ''; progressBar.style.backgroundColor = ''; }
    document.getElementById('upload-progress-container').classList.add('hidden');
    document.getElementById('upload-status-text').innerText = 'Scanning volume mesh...';
    
    document.getElementById('public-result-card').classList.add('hidden');
    document.getElementById('public-upload-confirm').classList.add('hidden');
    
    // Hide calc loading and calculate button
    const calcLoading = document.getElementById('calc-loading');
    if (calcLoading) { calcLoading.classList.add('hidden'); calcLoading.style.display = 'none'; }
    const calcBtn = document.getElementById('public-calculate-btn');
    if (calcBtn) calcBtn.classList.add('hidden');
    
    // Restore dropzone
    document.getElementById('upload-zone').classList.remove('hidden');
    
    // Clear 3D model
    if (stlMesh) {
        scene.remove(stlMesh);
        stlMesh = null;
    }
    
    // Reset Viewport placeholder
    document.getElementById('viewer-placeholder').classList.remove('hidden');
    document.getElementById('stl-canvas').classList.add('hidden');
    document.getElementById('viewer-legend').classList.add('hidden');
}

// 4. Admin Calculator Logic
function populateAdminSelects() {
    const matSelect = document.getElementById('admin-material');
    const machSelect = document.getElementById('admin-machine');
    
    if (!matSelect || !machSelect) return;
    
    matSelect.innerHTML = '';
    machSelect.innerHTML = '';
    
    materials.forEach(mat => {
        const opt = document.createElement('option');
        opt.value = mat.id;
        opt.text = mat.name;
        matSelect.appendChild(opt);
    });
    
    machines.forEach(mach => {
        const opt = document.createElement('option');
        opt.value = mach.id;
        opt.text = mach.name;
        machSelect.appendChild(opt);
    });
}

function setupAdminCalculator() {
    const form = document.getElementById('admin-calc-form');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const payload = {
            material_id: document.getElementById('admin-material').value,
            machine_id: document.getElementById('admin-machine').value,
            weight_g: parseFloat(document.getElementById('admin-weight').value),
            print_time_mins: parseFloat(document.getElementById('admin-time').value),
            labor_hours: parseFloat(document.getElementById('admin-labor').value || 0)
        };
        
        // Use developer active API key if logged in, fallback to default key
        const activeKey = localStorage.getItem('replica_active_dev_key') || 'replica_default_key';
        
        try {
            const response = await fetch('/api/estimate/admin', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-API-Key': activeKey
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            
            if (data.success) {
                renderInvoice(data.breakdown);
            } else {
                showToast('Calculation failed: ' + data.detail, 'error');
            }
        } catch (error) {
            console.error('Error during precise calculation:', error);
            showToast('Failed to connect to API service.', 'error');
        }
    });
}

function renderInvoice(bd) {
    document.getElementById('admin-placeholder').classList.add('hidden');
    document.getElementById('admin-result-container').classList.remove('hidden');
    
    document.getElementById('inv-mat-cost').innerText = `${bd.material_cost.toFixed(2)} TND`;
    document.getElementById('inv-elec-cost').innerText = `${bd.electricity_cost.toFixed(2)} TND`;
    document.getElementById('inv-direct-cost').innerText = `${bd.direct_cost.toFixed(2)} TND`;
    document.getElementById('inv-wear-cost').innerText = `${bd.wear_tear.toFixed(2)} TND`;
    document.getElementById('inv-labor-cost').innerText = `${bd.labor_cost.toFixed(2)} TND`;
    document.getElementById('inv-subtotal').innerText = `${bd.subtotal.toFixed(2)} TND`;
    
    const marginAmount = bd.selling_price - bd.subtotal;
    document.getElementById('inv-margin-val').innerText = `${marginAmount.toFixed(2)} TND`;
    
    document.getElementById('inv-selling-price').innerText = bd.selling_price.toFixed(2);
}

// 5. Settings Dashboard Logic
function setupSettingsPanel() {
    const devSettingsForm = document.getElementById('developer-settings-form');
    if (devSettingsForm) {
        devSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveDeveloperSettings();
        });
    }
}


function populateSettingsFields(data) {
    const cfg = data.global_settings;
    
    document.getElementById('cfg-electricity').value = cfg.electricity_rate;
    document.getElementById('cfg-wear-tear').value = cfg.wear_tear_percent;
    document.getElementById('cfg-margin').value = cfg.margin_percent;
    document.getElementById('cfg-labor').value = cfg.labor_rate_hourly;
    document.getElementById('cfg-infill').value = cfg.infill_ratio;
    document.getElementById('cfg-support').value = cfg.support_buffer_percent;
    document.getElementById('cfg-upload-limit').value = cfg.upload_limit_count !== undefined ? cfg.upload_limit_count : 5;
    document.getElementById('cfg-upload-cooldown').value = cfg.upload_cooldown_seconds !== undefined ? cfg.upload_cooldown_seconds : 60;
    
    // Populate Materials Table
    const matTbody = document.getElementById('settings-materials-tbody');
    matTbody.innerHTML = '';
    data.materials.forEach(mat => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-weight: 700;">${mat.name}</td>
            <td><input type="number" step="0.01" class="tbl-input mat-density" data-id="${mat.id}" value="${mat.density_g_cm3}"></td>
            <td><input type="number" step="1" class="tbl-input mat-price" data-id="${mat.id}" value="${mat.price_per_kg}"></td>
        `;
        matTbody.appendChild(row);
    });
    
    // Populate Machines Table
    const machTbody = document.getElementById('settings-machines-tbody');
    machTbody.innerHTML = '';
    data.machines.forEach(mach => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-weight: 700;">${mach.name}</td>
            <td><input type="number" step="10" class="tbl-input mach-power" data-id="${mach.id}" value="${mach.power_watts}"></td>
            <td><input type="number" step="1" class="tbl-input mach-premium" data-id="${mach.id}" value="${mach.flat_premium}"></td>
        `;
        machTbody.appendChild(row);
    });
}

async function saveAllSettings() {
    if (!isSettingsUnlocked) return;
    
    // Construct payload
    const global_settings = {
        electricity_rate: parseFloat(document.getElementById('cfg-electricity').value),
        wear_tear_percent: parseFloat(document.getElementById('cfg-wear-tear').value),
        margin_percent: parseFloat(document.getElementById('cfg-margin').value),
        labor_rate_hourly: parseFloat(document.getElementById('cfg-labor').value),
        infill_ratio: parseFloat(document.getElementById('cfg-infill').value),
        support_buffer_percent: parseFloat(document.getElementById('cfg-support').value),
        upload_limit_count: parseFloat(document.getElementById('cfg-upload-limit').value),
        upload_cooldown_seconds: parseFloat(document.getElementById('cfg-upload-cooldown').value)
    };
    
    const matRows = document.querySelectorAll('#settings-materials-tbody tr');
    const materialsPayload = [];
    matRows.forEach(row => {
        const densityInput = row.querySelector('.mat-density');
        const priceInput = row.querySelector('.mat-price');
        const id = densityInput.getAttribute('data-id');
        const name = row.querySelector('td').innerText;
        materialsPayload.push({
            id: id,
            name: name,
            density_g_cm3: parseFloat(densityInput.value),
            price_per_kg: parseFloat(priceInput.value)
        });
    });
    
    const machRows = document.querySelectorAll('#settings-machines-tbody tr');
    const machinesPayload = [];
    machRows.forEach(row => {
        const powerInput = row.querySelector('.mach-power');
        const premiumInput = row.querySelector('.mach-premium');
        const id = powerInput.getAttribute('data-id');
        const name = row.querySelector('td').innerText;
        machinesPayload.push({
            id: id,
            name: name,
            power_watts: parseFloat(powerInput.value),
            flat_premium: parseFloat(premiumInput.value)
        });
    });
    
    const payload = {
        passcode: enteredPasscode,
        global_settings: global_settings,
        materials: materialsPayload,
        machines: machinesPayload
    };
    
    try {
        const response = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            showToast('Configurations saved successfully!', 'success');
            // Refresh configs
            await fetchConfig();
        } else {
            const err = await response.json();
            showToast('Failed to save settings: ' + err.detail, 'error');
        }
    } catch (e) {
        console.error('Error saving configurations:', e);
        showToast('Network error while saving settings.', 'error');
    }
}

// 6. Three.js 3D Viewer Implementation
function initThreeJS() {
    const canvas = document.getElementById('stl-canvas');
    const container = canvas.parentElement;
    
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040406);
    
    // Camera
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    
    // Controls
    if (typeof THREE.OrbitControls !== 'undefined') {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
    } else if (typeof OrbitControls !== 'undefined') {
        controls = new OrbitControls(camera, renderer.domElement);
    }
    
    if (controls) {
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enableZoom = true;
        controls.maxDistance = 300;
        controls.minDistance = 10;
    }
    
    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight1.position.set(1, 1, 1).normalize();
    scene.add(dirLight1);
    
    const dirLight2 = new THREE.DirectionalLight(0x6366f1, 0.5); // Primary color tint
    dirLight2.position.set(-1, -1, 1).normalize();
    scene.add(dirLight2);
    
    const pointLight = new THREE.PointLight(0x06b6d4, 0.8, 100); // Cyan glow
    pointLight.position.set(0, 50, 0);
    scene.add(pointLight);
    
    // Start animation loop
    animate();
    
    // Handle window resize
    window.addEventListener('resize', resizeThreeJS);
}

function resizeThreeJS() {
    const canvas = document.getElementById('stl-canvas');
    const container = canvas.parentElement;
    if (canvas && container && renderer && camera) {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);
    
    if (controls) controls.update();
    
    if (stlMesh) {
        // Slow auto-rotation
        stlMesh.rotation.y += 0.005;
    }
    
    renderer.render(scene, camera);
}

// Map material IDs to display colors
function getMaterialColor(id) {
    switch (id) {
        case 'pla': return 0xc084fc; // Purple
        case 'petg': return 0x60a5fa; // Blue
        case 'abs': return 0x374151; // Dark Grey
        case 'asa': return 0x9ca3af; // Light Grey
        case 'tpu': return 0xf59e0b; // Amber/Yellow
        default: return 0x818cf8;    // Indigo default
    }
}

function updateMeshMaterialColor(matId) {
    if (!stlMesh) return;
    
    const color = getMaterialColor(matId);
    stlMesh.material.color.setHex(color);
}

function loadStlInViewer(arrayBuffer) {
    document.getElementById('viewer-placeholder').classList.add('hidden');
    document.getElementById('viewer-loading').classList.remove('hidden');
    document.getElementById('stl-canvas').classList.add('hidden');
    document.getElementById('viewer-legend').classList.add('hidden');
    
    // Clear old mesh
    if (stlMesh) {
        scene.remove(stlMesh);
        stlMesh = null;
    }
    
    setTimeout(() => {
        try {
            const loader = new THREE.STLLoader();
            const geometry = loader.parse(arrayBuffer);
            
            // Premium material setup
            const materialColor = getMaterialColor(selectedPublicMaterialId);
            const material = new THREE.MeshStandardMaterial({
                color: materialColor,
                metalness: 0.7,
                roughness: 0.3,
                flatShading: true
            });
            
            stlMesh = new THREE.Mesh(geometry, material);
            
            // Center the model geometry
            geometry.center();
            
            // Scale and reposition camera dynamically based on model bounding sphere
            geometry.computeBoundingSphere();
            const sphere = geometry.boundingSphere;
            const radius = sphere.radius;
            
            // Adjust model scaling if it is too massive or tiny
            const targetRadius = 30;
            const scale = targetRadius / radius;
            stlMesh.scale.set(scale, scale, scale);
            
            scene.add(stlMesh);
            
            // Point lights at the object center
            camera.position.set(0, 0, 75);
            if (controls) controls.target.set(0, 0, 0);
            
            // Transition UI elements
            document.getElementById('viewer-loading').classList.add('hidden');
            document.getElementById('stl-canvas').classList.remove('hidden');
            document.getElementById('viewer-legend').classList.remove('hidden');
            
            resizeThreeJS();
        } catch (err) {
            console.error('Error loading STL mesh into Three.js scene:', err);
            document.getElementById('viewer-loading').classList.add('hidden');
            document.getElementById('viewer-placeholder').classList.remove('hidden');
            alert('Failed to render 3D model preview.');
        }
    }, 100);
}

/// 7. Developer Portal (Multi-tenant Dashboard & Auth)
function setupDeveloperPortal() {
    const loginForm = document.getElementById('developer-login-form');
    const registerForm = document.getElementById('developer-register-form');
    
    const loginTabBtn = document.getElementById('auth-login-tab-btn');
    const registerTabBtn = document.getElementById('auth-register-tab-btn');
    const forgotLink = document.getElementById('forgot-password-link');
    
    const logoutBtn = document.getElementById('developer-logout-btn');
    const generateDevKeyForm = document.getElementById('generate-dev-key-form');
    
    const forgotModal = document.getElementById('forgot-password-modal');
    const forgotModalClose = document.getElementById('forgot-modal-close');
    const forgotModalCancel = document.getElementById('forgot-modal-cancel');
    
    // Auth Tab switching
    if (loginTabBtn && registerTabBtn) {
        loginTabBtn.addEventListener('click', () => {
            loginTabBtn.classList.add('active');
            registerTabBtn.classList.remove('active');
            loginForm.classList.remove('hidden');
            registerForm.classList.add('hidden');
        });
        
        registerTabBtn.addEventListener('click', () => {
            registerTabBtn.classList.add('active');
            loginTabBtn.classList.remove('active');
            registerForm.classList.remove('hidden');
            loginForm.classList.add('hidden');
        });
    }
    
    // Forgot password opens modal
    if (forgotLink) {
        forgotLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (forgotModal) {
                forgotModal.classList.remove('hidden');
                const emailInput = document.getElementById('forgot-email');
                if (emailInput) emailInput.focus();
            }
        });
    }
    
    const closeForgotModal = () => {
        if (forgotModal) {
            forgotModal.classList.add('hidden');
            const forgotForm = document.getElementById('developer-forgot-form');
            if (forgotForm) forgotForm.reset();
        }
    };
    
    if (forgotModalClose) forgotModalClose.addEventListener('click', closeForgotModal);
    if (forgotModalCancel) forgotModalCancel.addEventListener('click', closeForgotModal);
    
    // Close modal when clicking outside
    if (forgotModal) {
        forgotModal.addEventListener('click', (e) => {
            if (e.target === forgotModal) closeForgotModal();
        });
    }
    
    // Registration submission
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                username: document.getElementById('register-username').value,
                email: document.getElementById('register-email').value,
                password: document.getElementById('register-password').value
            };
            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (response.ok) {
                    showToast(data.message || 'Registration successful! Verification email sent.', 'success');
                    registerForm.reset();
                    if (loginTabBtn) loginTabBtn.click();
                } else {
                    showToast(data.detail || 'Registration failed.', 'error');
                }
            } catch (err) {
                console.error('Error during registration:', err);
                showToast('Network error during registration.', 'error');
            }
        });
    }
    
    // Login submission
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                identity: document.getElementById('login-identity').value,
                password: document.getElementById('login-password').value
            };
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (response.ok) {
                    localStorage.setItem('replica_dev_token', data.token);
                    localStorage.setItem('replica_dev_username', data.username);
                    loginForm.reset();
                    showToast('Logged in successfully!', 'success');
                    showDeveloperDashboard(data.username);
                } else {
                    showToast(data.detail || 'Login failed.', 'error');
                }
            } catch (err) {
                console.error('Error during login:', err);
                showToast('Network error during login.', 'error');
            }
        });
    }
    
    // Forgot Password submission
    const forgotForm = document.getElementById('developer-forgot-form');
    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                email: document.getElementById('forgot-email').value
            };
            try {
                const response = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (response.ok) {
                    showToast(data.message || 'If registered, reset link has been emailed.', 'success');
                    closeForgotModal();
                } else {
                    showToast(data.detail || 'Failed to send reset link.', 'error');
                }
            } catch (err) {
                console.error('Error during forgot password request:', err);
                showToast('Network error.', 'error');
            }
        });
    }
    
    // Logout click
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const token = localStorage.getItem('replica_dev_token');
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (err) {
                console.error('Logout request failed:', err);
            }
            localStorage.removeItem('replica_dev_token');
            localStorage.removeItem('replica_dev_username');
            localStorage.removeItem('replica_active_dev_key');
            showToast('Logged out.', 'success');
            showDeveloperAuth();
        });
    }
    
    // Generate Developer Key submission
    if (generateDevKeyForm) {
        generateDevKeyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = localStorage.getItem('replica_dev_token');
            const payload = {
                owner: document.getElementById('dev-key-owner').value
            };
            try {
                const response = await fetch('/api/developer/keys', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (response.ok) {
                    document.getElementById('dev-key-owner').value = '';
                    showToast('API Key generated successfully!', 'success');
                    await loadDeveloperKeys();
                } else {
                    showToast(data.detail || 'Failed to generate key.', 'error');
                }
            } catch (err) {
                console.error('Error generating developer key:', err);
            }
        });
    }
}

function loadDeveloperPortal() {
    const token = localStorage.getItem('replica_dev_token');
    const username = localStorage.getItem('replica_dev_username');
    if (token && username) {
        showDeveloperDashboard(username);
    } else {
        showDeveloperAuth();
    }
}

function showDeveloperDashboard(username) {
    document.getElementById('developer-auth-card').classList.add('hidden');
    document.getElementById('developer-dashboard-card').classList.remove('hidden');
    document.getElementById('dev-username-span').innerText = username;
    loadDeveloperKeys();
    loadDeveloperSettings();
    loadDeveloperUploads();
}

function showDeveloperAuth() {
    document.getElementById('developer-auth-card').classList.remove('hidden');
    document.getElementById('developer-dashboard-card').classList.add('hidden');
}

async function loadDeveloperKeys() {
    const token = localStorage.getItem('replica_dev_token');
    if (!token) return;
    try {
        const response = await fetch('/api/developer/keys', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const keys = await response.json();
            renderDeveloperKeysTable(keys);
            
            const activeKey = keys.find(k => k.is_active);
            if (activeKey) {
                localStorage.setItem('replica_active_dev_key', activeKey.key);
            } else {
                localStorage.removeItem('replica_active_dev_key');
            }
        }
    } catch (err) {
        console.error('Failed to load developer keys:', err);
    }
}

function renderDeveloperKeysTable(keys) {
    const tbody = document.getElementById('developer-keys-tbody');
    tbody.innerHTML = '';
    
    if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No API keys generated yet.</td></tr>`;
        return;
    }
    
    keys.forEach(k => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-weight: 700;">${escapeHtml(k.owner)}</td>
            <td>
                <span class="key-text" onclick="copyToClipboard('${k.key}')" title="Click to copy">
                    <i class="fa-solid fa-copy"></i> <code>${k.key}</code>
                </span>
            </td>
            <td style="font-weight: 600; text-align: center;">${k.calls_count}</td>
            <td style="text-align: center;">
                <button class="tbl-btn btn-danger delete-dev-key-btn" data-key="${k.key}" title="Delete Key">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    tbody.querySelectorAll('.delete-dev-key-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key = btn.getAttribute('data-key');
            if (confirm('Are you sure you want to delete this developer API key?')) {
                await deleteDeveloperKey(key);
            }
        });
    });
}

async function deleteDeveloperKey(key) {
    const token = localStorage.getItem('replica_dev_token');
    try {
        const response = await fetch(`/api/developer/keys/${key}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            showToast('Key deleted.', 'success');
            await loadDeveloperKeys();
        } else {
            const err = await response.json();
            showToast('Failed to delete key: ' + err.detail, 'error');
        }
    } catch (e) {
        console.error('Error deleting developer key:', e);
    }
}

async function loadDeveloperSettings() {
    const token = localStorage.getItem('replica_dev_token');
    if (!token) return;
    try {
        const response = await fetch('/api/developer/settings', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const data = await response.json();
            materials = data.materials;
            machines = data.machines;
            globalSettings = data.global_settings;
            
            populateAdminSelects();
            populateSettingsFields(data);
        }
    } catch (err) {
        console.error('Failed to load developer settings:', err);
    }
}

async function saveDeveloperSettings() {
    const token = localStorage.getItem('replica_dev_token');
    if (!token) return;
    
    const global_settings = {
        electricity_rate: parseFloat(document.getElementById('cfg-electricity').value),
        wear_tear_percent: parseFloat(document.getElementById('cfg-wear-tear').value),
        margin_percent: parseFloat(document.getElementById('cfg-margin').value),
        labor_rate_hourly: parseFloat(document.getElementById('cfg-labor').value),
        infill_ratio: parseFloat(document.getElementById('cfg-infill').value),
        support_buffer_percent: parseFloat(document.getElementById('cfg-support').value)
    };
    
    const matRows = document.querySelectorAll('#settings-materials-tbody tr');
    const materialsPayload = [];
    matRows.forEach(row => {
        const densityInput = row.querySelector('.mat-density');
        const priceInput = row.querySelector('.mat-price');
        const id = densityInput.getAttribute('data-id');
        const name = row.querySelector('td').innerText;
        materialsPayload.push({
            id: id,
            name: name,
            density_g_cm3: parseFloat(densityInput.value),
            price_per_kg: parseFloat(priceInput.value)
        });
    });
    
    const machRows = document.querySelectorAll('#settings-machines-tbody tr');
    const machinesPayload = [];
    machRows.forEach(row => {
        const powerInput = row.querySelector('.mach-power');
        const premiumInput = row.querySelector('.mach-premium');
        const id = powerInput.getAttribute('data-id');
        const name = row.querySelector('td').innerText;
        machinesPayload.push({
            id: id,
            name: name,
            power_watts: parseFloat(powerInput.value),
            flat_premium: parseFloat(premiumInput.value)
        });
    });
    
    const payload = {
        global_settings: global_settings,
        materials: materialsPayload,
        machines: machinesPayload
    };
    
    try {
        const response = await fetch('/api/developer/settings', {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            showToast('Configurations saved successfully!', 'success');
            await loadDeveloperSettings();
        } else {
            const err = await response.json();
            showToast('Failed to save settings: ' + err.detail, 'error');
        }
    } catch (e) {
        console.error('Error saving developer settings:', e);
        showToast('Network error while saving settings.', 'error');
    }
}

async function loadDeveloperUploads() {
    const token = localStorage.getItem('replica_dev_token');
    if (!token) return;
    try {
        const response = await fetch('/api/developer/uploads', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const uploads = await response.json();
            renderDeveloperUploadsTable(uploads);
        }
    } catch (err) {
        console.error('Failed to load developer uploads:', err);
    }
}

function renderDeveloperUploadsTable(uploads) {
    const tbody = document.getElementById('developer-uploads-tbody');
    tbody.innerHTML = '';
    
    if (uploads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No STL uploads logged using your API keys yet.</td></tr>`;
        return;
    }
    
    uploads.forEach(u => {
        const row = document.createElement('tr');
        const date = new Date(u.created_at);
        const dateStr = date.toLocaleString();
        
        row.innerHTML = `
            <td style="color: var(--text-muted); font-size: 0.8rem;">${dateStr}</td>
            <td style="font-weight: 700;">${escapeHtml(u.original_filename)}</td>
            <td style="text-align: center; font-weight: 600;">${u.volume_cm3.toFixed(3)}</td>
            <td style="text-align: center; font-weight: 600;">${u.estimated_weight_g.toFixed(1)}</td>
            <td style="font-weight: 700; color: #a5b4fc;">${escapeHtml(u.price_range)}</td>
            <td>
                <span style="font-family: monospace; font-size: 0.75rem; background: rgba(0,0,0,0.2); padding: 0.2rem 0.4rem; border-radius: 4px;">
                    ${escapeHtml(u.api_key_used)}
                </span>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function populateSettingsFields(data) {
    const cfg = data.global_settings;
    
    document.getElementById('cfg-electricity').value = cfg.electricity_rate;
    document.getElementById('cfg-wear-tear').value = cfg.wear_tear_percent;
    document.getElementById('cfg-margin').value = cfg.margin_percent;
    document.getElementById('cfg-labor').value = cfg.labor_rate_hourly;
    document.getElementById('cfg-infill').value = cfg.infill_ratio;
    document.getElementById('cfg-support').value = cfg.support_buffer_percent;
    
    const matTbody = document.getElementById('settings-materials-tbody');
    matTbody.innerHTML = '';
    data.materials.forEach(mat => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-weight: 700;">${mat.name}</td>
            <td><input type="number" step="0.01" class="tbl-input mat-density" data-id="${mat.id}" value="${mat.density_g_cm3}"></td>
            <td><input type="number" step="1" class="tbl-input mat-price" data-id="${mat.id}" value="${mat.price_per_kg}"></td>
        `;
        matTbody.appendChild(row);
    });
    
    const machTbody = document.getElementById('settings-machines-tbody');
    machTbody.innerHTML = '';
    data.machines.forEach(mach => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-weight: 700;">${mach.name}</td>
            <td><input type="number" step="10" class="tbl-input mach-power" data-id="${mach.id}" value="${mach.power_watts}"></td>
            <td><input type="number" step="1" class="tbl-input mach-premium" data-id="${mach.id}" value="${mach.flat_premium}"></td>
        `;
        machTbody.appendChild(row);
    });
}

// 8. Super Admin Administration Section
let isSuperAdminUnlocked = false;
let superadminToken = '';

function setupSuperAdminPortal() {
    const lockScreen = document.getElementById('superadmin-lock-screen');
    const dashboardCard = document.getElementById('superadmin-dashboard-card');
    const passcodeBtn = document.getElementById('unlock-superadmin-btn');
    const passcodeInput = document.getElementById('superadmin-passcode');
    const errorText = document.getElementById('superadmin-lock-error-text');
    const logoutBtn = document.getElementById('superadmin-logout-btn');
    const globalSettingsForm = document.getElementById('sa-global-settings-form');
    const generateSaKeyForm = document.getElementById('generate-sa-key-form');
    
    const unlock = async () => {
        const payload = { password: passcodeInput.value };
        try {
            const response = await fetch('/api/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (response.ok) {
                isSuperAdminUnlocked = true;
                superadminToken = data.token;
                sessionStorage.setItem('replica_admin_token', data.token);
                lockScreen.classList.add('hidden');
                dashboardCard.classList.remove('hidden');
                errorText.classList.add('hidden');
                passcodeInput.value = '';
                showToast('Welcome Super Admin!', 'success');
                await loadSuperAdminData();
            } else {
                errorText.innerText = data.detail || 'Unlock failed.';
                errorText.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Error unlocking admin portal:', err);
            errorText.innerText = 'Network error.';
            errorText.classList.remove('hidden');
        }
    };
    
    if (passcodeBtn) {
        passcodeBtn.addEventListener('click', unlock);
    }
    if (passcodeInput) {
        passcodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') unlock();
        });
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            isSuperAdminUnlocked = false;
            superadminToken = '';
            sessionStorage.removeItem('replica_admin_token');
            lockScreen.classList.remove('hidden');
            dashboardCard.classList.add('hidden');
            showToast('Locked Super Admin session.', 'info');
        });
    }
    
    if (globalSettingsForm) {
        globalSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveSuperAdminSettings();
        });
    }
    
    if (generateSaKeyForm) {
        generateSaKeyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await generateSuperAdminKey();
        });
    }
    
    // Auto-login from sessionStorage
    const savedToken = sessionStorage.getItem('replica_admin_token');
    if (savedToken) {
        isSuperAdminUnlocked = true;
        superadminToken = savedToken;
        lockScreen.classList.add('hidden');
        dashboardCard.classList.remove('hidden');
        loadSuperAdminData();
    }
}

function loadSuperAdminPortal() {
    const savedToken = sessionStorage.getItem('replica_admin_token');
    if (savedToken) {
        isSuperAdminUnlocked = true;
        superadminToken = savedToken;
        document.getElementById('superadmin-lock-screen').classList.add('hidden');
        document.getElementById('superadmin-dashboard-card').classList.remove('hidden');
        loadSuperAdminData();
    }
}

async function loadSuperAdminData() {
    if (!isSuperAdminUnlocked) return;
    await Promise.all([
        loadSuperAdminSettings(),
        loadSuperAdminUsers(),
        loadSuperAdminKeys(),
        loadSuperAdminUploads()
    ]);
}

async function loadSuperAdminSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const data = await response.json();
            const cfg = data.global_settings;
            
            document.getElementById('sa-public-infill').value = cfg.public_infill_ratio !== undefined ? cfg.public_infill_ratio : 20;
            document.getElementById('sa-public-support').value = cfg.public_support_buffer_percent !== undefined ? cfg.public_support_buffer_percent : 10;
            document.getElementById('sa-public-min-price').value = cfg.public_min_price_cap !== undefined ? cfg.public_min_price_cap : 15;
            document.getElementById('sa-public-margin').value = cfg.margin_percent !== undefined ? cfg.margin_percent : 20;
            document.getElementById('sa-public-min-offset').value = cfg.public_price_range_min_offset !== undefined ? cfg.public_price_range_min_offset : 90;
            document.getElementById('sa-public-max-offset').value = cfg.public_price_range_max_offset !== undefined ? cfg.public_price_range_max_offset : 115;
            document.getElementById('sa-upload-limit').value = cfg.upload_limit_count !== undefined ? cfg.upload_limit_count : 5;
            document.getElementById('sa-upload-cooldown').value = cfg.upload_cooldown_seconds !== undefined ? cfg.upload_cooldown_seconds : 60;
            
            const matTbody = document.getElementById('sa-materials-tbody');
            matTbody.innerHTML = '';
            data.materials.forEach(mat => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="font-weight: 700;">${mat.name}</td>
                    <td><input type="number" step="0.01" class="tbl-input sa-mat-density" data-id="${mat.id}" value="${mat.density_g_cm3}"></td>
                    <td><input type="number" step="1" class="tbl-input sa-mat-price" data-id="${mat.id}" value="${mat.price_per_kg}"></td>
                `;
                matTbody.appendChild(row);
            });
            
            const machTbody = document.getElementById('sa-machines-tbody');
            machTbody.innerHTML = '';
            data.machines.forEach(mach => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="font-weight: 700;">${mach.name}</td>
                    <td><input type="number" step="10" class="tbl-input sa-mach-power" data-id="${mach.id}" value="${mach.power_watts}"></td>
                    <td><input type="number" step="1" class="tbl-input sa-mach-premium" data-id="${mach.id}" value="${mach.flat_premium}"></td>
                `;
                machTbody.appendChild(row);
            });
        }
    } catch (err) {
        console.error('Failed to load Super Admin settings:', err);
    }
}

async function saveSuperAdminSettings() {
    if (!isSuperAdminUnlocked) return;
    
    const global_settings = {
        public_infill_ratio: parseFloat(document.getElementById('sa-public-infill').value),
        public_support_buffer_percent: parseFloat(document.getElementById('sa-public-support').value),
        public_min_price_cap: parseFloat(document.getElementById('sa-public-min-price').value),
        margin_percent: parseFloat(document.getElementById('sa-public-margin').value),
        public_price_range_min_offset: parseFloat(document.getElementById('sa-public-min-offset').value),
        public_price_range_max_offset: parseFloat(document.getElementById('sa-public-max-offset').value),
        upload_limit_count: parseFloat(document.getElementById('sa-upload-limit').value),
        upload_cooldown_seconds: parseFloat(document.getElementById('sa-upload-cooldown').value)
    };
    
    const matRows = document.querySelectorAll('#sa-materials-tbody tr');
    const materialsPayload = [];
    matRows.forEach(row => {
        const densityInput = row.querySelector('.sa-mat-density');
        const priceInput = row.querySelector('.sa-mat-price');
        if (densityInput && priceInput) {
            const id = densityInput.getAttribute('data-id');
            const name = row.querySelector('td').innerText;
            materialsPayload.push({
                id: id,
                name: name,
                density_g_cm3: parseFloat(densityInput.value),
                price_per_kg: parseFloat(priceInput.value)
            });
        }
    });
    
    const machRows = document.querySelectorAll('#sa-machines-tbody tr');
    const machinesPayload = [];
    machRows.forEach(row => {
        const powerInput = row.querySelector('.sa-mach-power');
        const premiumInput = row.querySelector('.sa-mach-premium');
        if (powerInput && premiumInput) {
            const id = powerInput.getAttribute('data-id');
            const name = row.querySelector('td').innerText;
            machinesPayload.push({
                id: id,
                name: name,
                power_watts: parseFloat(powerInput.value),
                flat_premium: parseFloat(premiumInput.value)
            });
        }
    });
    
    const payload = {
        global_settings: global_settings,
        materials: materialsPayload,
        machines: machinesPayload
    };
    
    try {
        const response = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'X-Admin-Token': superadminToken
            },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            showToast('Platform Configurations saved successfully!', 'success');
            await loadSuperAdminSettings();
            await fetchConfig(); // Refresh public configs too
        } else {
            const err = await response.json();
            showToast('Failed to save platform settings: ' + err.detail, 'error');
        }
    } catch (e) {
        console.error('Error saving global settings:', e);
        showToast('Network error while saving.', 'error');
    }
}

async function loadSuperAdminUsers() {
    if (!isSuperAdminUnlocked) return;
    try {
        const response = await fetch('/api/admin/users', {
            headers: { 'X-Admin-Token': superadminToken }
        });
        if (response.ok) {
            const users = await response.json();
            renderSuperAdminUsersTable(users);
        }
    } catch (err) {
        console.error('Failed to load Super Admin users:', err);
    }
}

function renderSuperAdminUsersTable(users) {
    const tbody = document.getElementById('sa-users-tbody');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No user accounts registered yet.</td></tr>`;
        return;
    }
    
    users.forEach(u => {
        const row = document.createElement('tr');
        const date = u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A';
        
        row.innerHTML = `
            <td>${u.id}</td>
            <td style="font-weight: 700;">${escapeHtml(u.username)}</td>
            <td>${date}</td>
            <td style="text-align: center; font-weight: 600;">${u.keys_count}</td>
            <td style="text-align: center; font-weight: 600; color: #a5b4fc;">${u.total_calls}</td>
            <td style="text-align: center;">
                <button class="tbl-btn sa-reset-btn" data-id="${u.id}" data-username="${u.username}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; background: var(--secondary); margin-right: 0.3rem;">
                    <i class="fa-solid fa-key"></i> Reset PW
                </button>
                <button class="tbl-btn btn-danger sa-delete-user-btn" data-id="${u.id}" data-username="${u.username}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    tbody.querySelectorAll('.sa-reset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const username = btn.getAttribute('data-username');
            const newPassword = prompt(`Enter new password for user '${username}' (min 6 chars):`);
            if (newPassword) {
                resetUserPassword(id, newPassword);
            }
        });
    });
    
    tbody.querySelectorAll('.sa-delete-user-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const username = btn.getAttribute('data-username');
            if (confirm(`Are you sure you want to permanently delete user account '${username}' and all their settings/keys?`)) {
                deleteUserAccount(id);
            }
        });
    });
}

async function resetUserPassword(userId, newPassword) {
    try {
        const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Admin-Token': superadminToken
            },
            body: JSON.stringify({ new_password: newPassword })
        });
        if (response.ok) {
            showToast('Password reset successfully!', 'success');
        } else {
            const err = await response.json();
            showToast('Failed to reset password: ' + err.detail, 'error');
        }
    } catch (e) {
        console.error('Error resetting password:', e);
    }
}

async function deleteUserAccount(userId) {
    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'X-Admin-Token': superadminToken }
        });
        if (response.ok) {
            showToast('User account deleted successfully.', 'success');
            await loadSuperAdminUsers();
        } else {
            const err = await response.json();
            showToast('Failed to delete user: ' + err.detail, 'error');
        }
    } catch (e) {
        console.error('Error deleting user:', e);
    }
}

async function loadSuperAdminKeys() {
    if (!isSuperAdminUnlocked) return;
    try {
        const response = await fetch('/api/admin/keys', {
            headers: { 'X-Admin-Token': superadminToken }
        });
        if (response.ok) {
            const keys = await response.json();
            renderSuperAdminKeysTable(keys);
        }
    } catch (err) {
        console.error('Failed to load Super Admin keys:', err);
    }
}

function renderSuperAdminKeysTable(keys) {
    const tbody = document.getElementById('sa-keys-tbody');
    tbody.innerHTML = '';
    
    if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No global API keys generated yet.</td></tr>`;
        return;
    }
    
    keys.forEach(k => {
        const row = document.createElement('tr');
        const activeText = k.is_active ? 'Deactivate' : 'Activate';
        
        row.innerHTML = `
            <td>
                <span class="key-text" onclick="copyToClipboard('${k.key}')" title="Click to copy">
                    <code>${k.key}</code>
                </span>
            </td>
            <td style="font-weight: 700;">${escapeHtml(k.owner)}</td>
            <td style="color: #67e8f9;">${escapeHtml(k.creator)}</td>
            <td style="text-align: center; font-weight: 600;">${k.calls_count}</td>
            <td style="text-align: center;">
                <button class="tbl-btn sa-toggle-key-btn" data-key="${k.key}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; margin-right: 0.3rem;">
                    ${activeText}
                </button>
                <button class="tbl-btn btn-danger sa-delete-key-btn" data-key="${k.key}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    tbody.querySelectorAll('.sa-toggle-key-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key = btn.getAttribute('data-key');
            await toggleSuperAdminKey(key);
        });
    });
    
    tbody.querySelectorAll('.sa-delete-key-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key = btn.getAttribute('data-key');
            if (confirm('Are you sure you want to delete this API key?')) {
                await deleteSuperAdminKey(key);
            }
        });
    });
}

async function toggleSuperAdminKey(key) {
    try {
        const response = await fetch(`/api/admin/keys/${key}/toggle`, {
            method: 'PUT',
            headers: { 'X-Admin-Token': superadminToken }
        });
        if (response.ok) {
            await loadSuperAdminKeys();
        }
    } catch (e) {
        console.error('Error toggling key:', e);
    }
}

async function deleteSuperAdminKey(key) {
    try {
        const response = await fetch(`/api/admin/keys/${key}`, {
            method: 'DELETE',
            headers: { 'X-Admin-Token': superadminToken }
        });
        if (response.ok) {
            showToast('API key deleted successfully.', 'success');
            await loadSuperAdminKeys();
        } else {
            const err = await response.json();
            showToast('Failed to delete key: ' + err.detail, 'error');
        }
    } catch (e) {
        console.error('Error deleting key:', e);
    }
}

async function generateSuperAdminKey() {
    const owner = document.getElementById('sa-key-owner').value;
    try {
        const response = await fetch('/api/admin/keys', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Admin-Token': superadminToken
            },
            body: JSON.stringify({ owner: owner })
        });
        if (response.ok) {
            document.getElementById('sa-key-owner').value = '';
            showToast('Global API key generated successfully!', 'success');
            await loadSuperAdminKeys();
        } else {
            const err = await response.json();
            showToast('Failed to generate key: ' + err.detail, 'error');
        }
    } catch (e) {
        console.error('Error generating key:', e);
    }
}

async function loadSuperAdminUploads() {
    if (!isSuperAdminUnlocked) return;
    try {
        const response = await fetch('/api/admin/uploads', {
            headers: { 'X-Admin-Token': superadminToken }
        });
        if (response.ok) {
            const uploads = await response.json();
            renderSuperAdminUploadsTable(uploads);
        }
    } catch (err) {
        console.error('Failed to load Super Admin uploads:', err);
    }
}

function renderSuperAdminUploadsTable(uploads) {
    const tbody = document.getElementById('sa-uploads-tbody');
    tbody.innerHTML = '';
    
    const selectAllCheckbox = document.getElementById('select-all-uploads');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
    }
    updateBulkDeleteButtonState();
    
    if (uploads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No mesh scans uploaded yet.</td></tr>`;
        return;
    }
    
    uploads.forEach(u => {
        const row = document.createElement('tr');
        const date = new Date(u.created_at).toLocaleString();
        
        row.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="upload-select-checkbox" data-id="${u.id}">
            </td>
            <td style="color: var(--text-muted); font-size: 0.8rem;">${date}</td>
            <td style="font-weight: 700;">${escapeHtml(u.original_filename)}</td>
            <td style="text-align: center; font-weight: 600;">${u.volume_cm3.toFixed(3)}</td>
            <td style="text-align: center; font-weight: 600;">${u.estimated_weight_g.toFixed(1)}</td>
            <td style="font-weight: 700; color: #a5b4fc;">${escapeHtml(u.price_range)}</td>
            <td>
                <span style="font-family: monospace; font-size: 0.75rem; background: rgba(0,0,0,0.2); padding: 0.2rem 0.4rem; border-radius: 4px;">
                    ${escapeHtml(u.api_key_used)}
                </span>
            </td>
            <td style="text-align: center;">
                <a href="/api/admin/uploads/${u.id}/download?admin_token=${encodeURIComponent(superadminToken)}" class="tbl-btn" style="text-decoration: none;" download>
                    <i class="fa-solid fa-download"></i> Download
                </a>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    const rowCheckboxes = document.querySelectorAll('.upload-select-checkbox');
    rowCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            updateBulkDeleteButtonState();
            const allChecked = Array.from(rowCheckboxes).every(c => c.checked);
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = allChecked;
            }
        });
    });
}

function updateBulkDeleteButtonState() {
    const selectedCheckboxes = document.querySelectorAll('.upload-select-checkbox:checked');
    const deleteBtn = document.getElementById('delete-selected-uploads-btn');
    const selectedCountSpan = document.getElementById('selected-uploads-count');
    
    if (deleteBtn && selectedCountSpan) {
        selectedCountSpan.innerText = selectedCheckboxes.length;
        if (selectedCheckboxes.length > 0) {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }
}

async function deleteSelectedUploads(ids) {
    try {
        const response = await fetch('/api/admin/uploads/bulk-delete', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Admin-Token': superadminToken
            },
            body: JSON.stringify({ ids: ids })
        });
        const data = await response.json();
        if (response.ok) {
            showToast(`Successfully deleted ${data.deleted_count} files!`, 'success');
            await loadSuperAdminUploads();
        } else {
            showToast(data.detail || 'Failed to delete files.', 'error');
        }
    } catch (e) {
        console.error('Error during bulk deletion:', e);
        showToast('Network error during deletion.', 'error');
    }
}

function setupBulkDelete() {
    const selectAllCheckbox = document.getElementById('select-all-uploads');
    const deleteBtn = document.getElementById('delete-selected-uploads-btn');
    
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
            const checkboxes = document.querySelectorAll('.upload-select-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = selectAllCheckbox.checked;
            });
            updateBulkDeleteButtonState();
        });
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const selectedCheckboxes = document.querySelectorAll('.upload-select-checkbox:checked');
            const ids = Array.from(selectedCheckboxes).map(cb => parseInt(cb.getAttribute('data-id')));
            if (ids.length === 0) return;
            
            showConfirmModal(`Are you sure you want to delete the ${ids.length} selected file(s)? This will permanently remove them from both the database and the server disk.`, async () => {
                await deleteSelectedUploads(ids);
            });
        });
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('API Key copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
}

let confirmModalCallback = null;

function showConfirmModal(text, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const textElement = document.getElementById('confirm-modal-text');
    
    if (modal && textElement) {
        textElement.innerText = text;
        confirmModalCallback = onConfirm;
        modal.classList.remove('hidden');
    }
}

function setupConfirmModalListeners() {
    const modal = document.getElementById('confirm-modal');
    const closeBtn = document.getElementById('confirm-modal-close');
    const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    
    const hide = () => {
        if (modal) {
            modal.classList.add('hidden');
        }
        confirmModalCallback = null;
    };
    
    if (closeBtn) closeBtn.addEventListener('click', hide);
    if (cancelBtn) cancelBtn.addEventListener('click', hide);
    
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            if (confirmModalCallback) {
                const cb = confirmModalCallback;
                hide();
                await cb();
            }
        });
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '<i class="fa-solid fa-circle-check" style="color: var(--success);"></i>';
    if (type === 'error') {
        icon = '<i class="fa-solid fa-circle-xmark" style="color: var(--error);"></i>';
    } else if (type === 'warning') {
        icon = '<i class="fa-solid fa-triangle-exclamation" style="color: var(--warning);"></i>';
    }
    
    toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    
    // Force browser reflow to enable transition
    toast.offsetHeight;
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

