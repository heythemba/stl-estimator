// Global State
let materials = [];
let machines = [];
let saMaterials = [];
let saMachines = [];
let addModalMode = 'dev';
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
    setupCustomButtons();
    setupConfigureEstimatorModal();
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
            
            checkConfigurationState();
            localStorage.setItem('replica_active_tab', targetTab);
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

    // Restore active main tab from localStorage if it exists
    const lastActiveTab = localStorage.getItem('replica_active_tab');
    if (lastActiveTab) {
        const targetBtn = document.querySelector(`.nav-btn[data-tab="${lastActiveTab}"]`);
        if (targetBtn) {
            targetBtn.click();
        }
    }

    // Remove the flicker prevention style tag if it exists
    const antiFlickerStyle = document.getElementById('tab-flicker-prevention');
    if (antiFlickerStyle) {
        antiFlickerStyle.remove();
    }
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
        checkConfigurationState();
    } catch (error) {
        console.error('Error fetching system configurations:', error);
        checkConfigurationState();
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
    
    // Infill slider logic
    const publicInfillSlider = document.getElementById('public-infill-slider');
    const publicInfillVal = document.getElementById('public-infill-val');
    if (publicInfillSlider && publicInfillVal) {
        publicInfillSlider.addEventListener('input', (e) => {
            publicInfillVal.textContent = e.target.value;
            if (activeStlFile && calcBtn) {
                calcBtn.classList.remove('hidden');
            }
        });
    }
    
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
    const isConfigured = materials && materials.length > 0 && 
                        machines && machines.length > 0 && 
                        globalSettings && Object.keys(globalSettings).length > 0;
    if (!isConfigured) {
        showToast('The estimator is not configured yet and cannot provide an estimation.', 'warning');
        const configModal = document.getElementById('configure-estimator-modal');
        if (configModal) {
            configModal.classList.remove('hidden');
        }
        return;
    }
    
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
            
        } else if (xhr.status === 429) {
            let waitSecs = 60;
            const retryAfter = xhr.getResponseHeader('Retry-After');
            if (retryAfter) {
                waitSecs = parseInt(retryAfter, 10);
            } else {
                const match = detail.match(/\d+/);
                if (match) waitSecs = parseInt(match[0], 10);
            }
            handleRateLimit(waitSecs);
            resetPublicEstimator();
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
    const isConfigured = materials && materials.length > 0 && 
                        machines && machines.length > 0 && 
                        globalSettings && Object.keys(globalSettings).length > 0;
    if (!isConfigured) {
        showToast('The estimator is not configured yet and cannot provide an estimation.', 'warning');
        const configModal = document.getElementById('configure-estimator-modal');
        if (configModal) {
            configModal.classList.remove('hidden');
        }
        return;
    }

    // Hide the Calculate button to prevent double-click
    const calcBtn = document.getElementById('public-calculate-btn');
    if (calcBtn) calcBtn.classList.add('hidden');
    
    // Hide stats panel, show spinner on the right
    document.getElementById('public-upload-confirm').classList.add('hidden');
    document.getElementById('public-result-card').classList.add('hidden');
    const calcLoading = document.getElementById('calc-loading');
    if (calcLoading) { calcLoading.classList.remove('hidden'); calcLoading.style.display = 'flex'; }
    
    // Re-send file silently (Option B — no second progress bar shown)
    const infillVal = document.getElementById('public-infill-slider') ? document.getElementById('public-infill-slider').value : 20;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('material_id', selectedPublicMaterialId);
    formData.append('infill', infillVal);
    
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
        } else if (xhr.status === 429) {
            let waitSecs = 60;
            const retryAfter = xhr.getResponseHeader('Retry-After');
            if (retryAfter) {
                waitSecs = parseInt(retryAfter, 10);
            } else {
                const match = detail.match(/\d+/);
                if (match) waitSecs = parseInt(match[0], 10);
            }
            handleRateLimit(waitSecs);
            resetPublicEstimator();
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
    
    // Setup Drag-and-Drop / click listener for Admin Cost Calculator STL upload
    const adminStlZone = document.getElementById('admin-stl-zone');
    const adminStlInput = document.getElementById('admin-stl-input');
    
    if (adminStlZone && adminStlInput) {
        adminStlZone.addEventListener('click', () => adminStlInput.click());
        
        adminStlZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            adminStlZone.style.borderColor = "var(--primary)";
            adminStlZone.style.background = "rgba(255,255,255,0.02)";
        });
        
        adminStlZone.addEventListener('dragleave', () => {
            adminStlZone.style.borderColor = "rgba(255,255,255,0.1)";
            adminStlZone.style.background = "none";
        });
        
        adminStlZone.addEventListener('drop', (e) => {
            e.preventDefault();
            adminStlZone.style.borderColor = "rgba(255,255,255,0.1)";
            adminStlZone.style.background = "none";
            if (e.dataTransfer.files.length > 0) {
                uploadStlForAdminCalc(e.dataTransfer.files[0]);
            }
        });
        
        adminStlInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadStlForAdminCalc(e.target.files[0]);
            }
        });
    }
    
    async function uploadStlForAdminCalc(file) {
        if (!file.name.toLowerCase().endsWith('.stl')) {
            showToast('Only STL files are supported', 'error');
            return;
        }
        
        const statusEl = document.getElementById('admin-stl-status');
        if (statusEl) {
            statusEl.innerText = "Analyzing STL file...";
            statusEl.style.color = "var(--primary)";
        }
        
        const activeKey = localStorage.getItem('replica_active_dev_key');
        if (!activeKey) {
            showToast('API Key required for STL analysis', 'error');
            if (statusEl) {
                statusEl.innerText = "Will auto-fill Weight and Print Time below";
                statusEl.style.color = "var(--text-muted)";
            }
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('material_id', document.getElementById('admin-material').value);
        formData.append('machine_id', document.getElementById('admin-machine').value);
        
        const infillVal = parseFloat(document.getElementById('admin-infill').value || 20);
        formData.append('infill', infillVal);
        
        try {
            const response = await fetch('/api/developer/estimate-stl', {
                method: 'POST',
                headers: {
                    'X-API-Key': activeKey
                },
                body: formData
            });
            const data = await response.json();
            if (response.ok && data.success) {
                document.getElementById('admin-weight').value = data.estimated_weight_g.toFixed(1);
                document.getElementById('admin-time').value = Math.round(data.estimated_time_mins);
                if (statusEl) {
                    statusEl.innerText = "Weight & Print Time auto-populated!";
                    statusEl.style.color = "#10b981";
                }
                showToast('STL parsed successfully. Weight & Print Time auto-populated.', 'success');
            } else {
                showToast('Failed to parse STL: ' + (data.detail || 'unknown error'), 'error');
                if (statusEl) {
                    statusEl.innerText = "Failed to parse STL file.";
                    statusEl.style.color = "#ef4444";
                }
            }
        } catch (error) {
            console.error('Error during developer STL estimate:', error);
            showToast('Error connecting to the STL estimation API.', 'error');
            if (statusEl) {
                statusEl.innerText = "Connection error.";
                statusEl.style.color = "#ef4444";
            }
        }
    }
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const payload = {
            material_id: document.getElementById('admin-material').value,
            machine_id: document.getElementById('admin-machine').value,
            weight_g: parseFloat(document.getElementById('admin-weight').value),
            print_time_mins: parseFloat(document.getElementById('admin-time').value),
            labor_hours: parseFloat(document.getElementById('admin-labor').value || 0),
            prep_type: document.getElementById('admin-prep-type').value,
            prep_hours: parseFloat(document.getElementById('admin-prep-hours').value || 0)
        };
        
        const activeKey = localStorage.getItem('replica_active_dev_key');
        if (!activeKey) {
            showToast('API Key required for the precise calculator', 'error');
            return;
        }
        
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
    if (document.getElementById('inv-prep-cost')) {
        document.getElementById('inv-prep-cost').innerText = `${bd.prep_cost.toFixed(2)} TND`;
    }
    document.getElementById('inv-subtotal').innerText = `${bd.subtotal.toFixed(2)} TND`;
    
    const marginVal = bd.margin_val !== undefined ? bd.margin_val : (bd.selling_price_ht - bd.subtotal);
    document.getElementById('inv-margin-val').innerText = `${marginVal.toFixed(2)} TND`;
    
    if (document.getElementById('inv-selling-price-ht')) {
        document.getElementById('inv-selling-price-ht').innerText = `${bd.selling_price_ht.toFixed(2)} TND`;
    }
    if (document.getElementById('inv-tax-amount')) {
        document.getElementById('inv-tax-amount').innerText = `${bd.tax_amount.toFixed(2)} TND`;
    }
    
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
    if (document.getElementById('cfg-labor-modeling')) {
        document.getElementById('cfg-labor-modeling').value = cfg.labor_modeling_rate !== undefined ? cfg.labor_modeling_rate : 15.0;
    }
    if (document.getElementById('cfg-labor-scanning')) {
        document.getElementById('cfg-labor-scanning').value = cfg.labor_scanning_rate !== undefined ? cfg.labor_scanning_rate : 25.0;
    }
    if (document.getElementById('cfg-tax-percent')) {
        document.getElementById('cfg-tax-percent').value = cfg.tax_percent !== undefined ? cfg.tax_percent : 19.0;
    }
    document.getElementById('cfg-support').value = cfg.support_buffer_percent;
    if (document.getElementById('cfg-upload-limit')) {
        document.getElementById('cfg-upload-limit').value = cfg.upload_limit_count !== undefined ? cfg.upload_limit_count : 5;
    }
    if (document.getElementById('cfg-upload-cooldown')) {
        document.getElementById('cfg-upload-cooldown').value = cfg.upload_cooldown_seconds !== undefined ? cfg.upload_cooldown_seconds : 60;
    }
    
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
        labor_modeling_rate: parseFloat(document.getElementById('cfg-labor-modeling').value),
        labor_scanning_rate: parseFloat(document.getElementById('cfg-labor-scanning').value),
        tax_percent: parseFloat(document.getElementById('cfg-tax-percent').value),
        support_buffer_percent: parseFloat(document.getElementById('cfg-support').value),
        upload_limit_count: document.getElementById('cfg-upload-limit') ? parseFloat(document.getElementById('cfg-upload-limit').value) : 5,
        upload_cooldown_seconds: document.getElementById('cfg-upload-cooldown') ? parseFloat(document.getElementById('cfg-upload-cooldown').value) : 60
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
            checkConfigurationState();
        }
    } catch (err) {
        console.error('Failed to load developer settings:', err);
        checkConfigurationState();
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
        labor_modeling_rate: parseFloat(document.getElementById('cfg-labor-modeling').value),
        labor_scanning_rate: parseFloat(document.getElementById('cfg-labor-scanning').value),
        tax_percent: parseFloat(document.getElementById('cfg-tax-percent').value),
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
        const providerInput = row.querySelector('.mach-provider');
        const enclosedInput = row.querySelector('.mach-enclosed');
        const id = powerInput.getAttribute('data-id');
        const name = row.querySelector('td').innerText;
        machinesPayload.push({
            id: id,
            name: name,
            provider: providerInput ? providerInput.value.trim() : '',
            power_watts: parseFloat(powerInput.value),
            flat_premium: parseFloat(premiumInput.value),
            enclosed: enclosedInput ? enclosedInput.checked : false
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
            <td style="font-weight: 700;">${escapeHtml(mat.name)}</td>
            <td><input type="number" step="0.01" class="tbl-input mat-density" data-id="${mat.id}" value="${mat.density_g_cm3}"></td>
            <td><input type="number" step="1" class="tbl-input mat-price" data-id="${mat.id}" value="${mat.price_per_kg}"></td>
            <td style="text-align: center;">
                <button type="button" class="tbl-btn btn-danger delete-material-btn" data-id="${mat.id}" title="Delete Filament" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        matTbody.appendChild(row);
    });
    
    const machTbody = document.getElementById('settings-machines-tbody');
    machTbody.innerHTML = '';
    data.machines.forEach(mach => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-weight: 700;">${escapeHtml(mach.name)}</td>
            <td><input type="text" class="tbl-input mach-provider" data-id="${mach.id}" value="${escapeHtml(mach.provider || '')}" placeholder="e.g. Bambulab"></td>
            <td><input type="number" step="10" class="tbl-input mach-power" data-id="${mach.id}" value="${mach.power_watts}"></td>
            <td><input type="number" step="1" class="tbl-input mach-premium" data-id="${mach.id}" value="${mach.flat_premium}"></td>
            <td style="text-align: center;">
                <input type="checkbox" class="mach-enclosed" data-id="${mach.id}" ${mach.enclosed ? 'checked' : ''} style="cursor: pointer; width: auto; transform: scale(1.1);">
            </td>
            <td style="text-align: center;">
                <button type="button" class="tbl-btn btn-danger delete-machine-btn" data-id="${mach.id}" title="Delete Machine" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        machTbody.appendChild(row);
    });
    
    // Bind Delete listeners
    matTbody.querySelectorAll('.delete-material-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            deleteLocalMaterial(id);
        });
    });
    
    machTbody.querySelectorAll('.delete-machine-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            deleteLocalMachine(id);
        });
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
        logoutBtn.addEventListener('click', async () => {
            if (superadminToken) {
                try {
                    await fetch('/api/admin/logout', {
                        method: 'POST',
                        headers: { 'X-Admin-Token': superadminToken }
                    });
                } catch (e) {
                    console.error('Failed backend logout call:', e);
                }
            }
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
    
    // Auto-login from sessionStorage with backend verification
    loadSuperAdminPortal();
}

function handleAdminUnauthorized() {
    isSuperAdminUnlocked = false;
    superadminToken = '';
    sessionStorage.removeItem('replica_admin_token');
    
    const lockScreen = document.getElementById('superadmin-lock-screen');
    const dashboardCard = document.getElementById('superadmin-dashboard-card');
    if (lockScreen) lockScreen.classList.remove('hidden');
    if (dashboardCard) dashboardCard.classList.add('hidden');
    
    showToast('Session expired or unauthorized. Please unlock again.', 'error');
}

async function loadSuperAdminPortal() {
    const savedToken = sessionStorage.getItem('replica_admin_token');
    const lockScreen = document.getElementById('superadmin-lock-screen');
    const dashboardCard = document.getElementById('superadmin-dashboard-card');
    
    if (savedToken) {
        try {
            const response = await fetch('/api/admin/users', {
                headers: { 'X-Admin-Token': savedToken }
            });
            if (response.ok) {
                isSuperAdminUnlocked = true;
                superadminToken = savedToken;
                if (lockScreen) lockScreen.classList.add('hidden');
                if (dashboardCard) dashboardCard.classList.remove('hidden');
                
                const users = await response.json();
                renderSuperAdminUsersTable(users);
                
                await Promise.all([
                    loadSuperAdminSettings(),
                    loadSuperAdminKeys(),
                    loadSuperAdminUploads()
                ]);
                return;
            } else if (response.status === 401 || response.status === 403) {
                handleAdminUnauthorized();
                return;
            }
        } catch (e) {
            console.error('Failed to validate admin session:', e);
        }
    }
    
    isSuperAdminUnlocked = false;
    superadminToken = '';
    sessionStorage.removeItem('replica_admin_token');
    if (lockScreen) lockScreen.classList.remove('hidden');
    if (dashboardCard) dashboardCard.classList.add('hidden');
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
            
            if (document.getElementById('sa-labor-modeling')) {
                document.getElementById('sa-labor-modeling').value = cfg.labor_modeling_rate !== undefined ? cfg.labor_modeling_rate : 15.0;
            }
            if (document.getElementById('sa-labor-scanning')) {
                document.getElementById('sa-labor-scanning').value = cfg.labor_scanning_rate !== undefined ? cfg.labor_scanning_rate : 25.0;
            }
            if (document.getElementById('sa-tax-percent')) {
                document.getElementById('sa-tax-percent').value = cfg.tax_percent !== undefined ? cfg.tax_percent : 19.0;
            }
            document.getElementById('sa-public-support').value = cfg.public_support_buffer_percent !== undefined ? cfg.public_support_buffer_percent : 10;
            document.getElementById('sa-public-min-price').value = cfg.public_min_price_cap !== undefined ? cfg.public_min_price_cap : 15;
            document.getElementById('sa-public-margin').value = cfg.margin_percent !== undefined ? cfg.margin_percent : 20;
            document.getElementById('sa-public-min-offset').value = cfg.public_price_range_min_offset !== undefined ? cfg.public_price_range_min_offset : 90;
            document.getElementById('sa-public-max-offset').value = cfg.public_price_range_max_offset !== undefined ? cfg.public_price_range_max_offset : 115;
            document.getElementById('sa-upload-limit').value = cfg.upload_limit_count !== undefined ? cfg.upload_limit_count : 5;
            document.getElementById('sa-upload-cooldown').value = cfg.upload_cooldown_seconds !== undefined ? cfg.upload_cooldown_seconds : 60;
            
            saMaterials = data.materials;
            saMachines = data.machines;
            renderSaMaterialsAndMachines(saMaterials, saMachines);
        }
    } catch (err) {
        console.error('Failed to load Super Admin settings:', err);
    }
}

async function saveSuperAdminSettings() {
    if (!isSuperAdminUnlocked) return;
    
    const global_settings = {
        labor_modeling_rate: parseFloat(document.getElementById('sa-labor-modeling').value),
        labor_scanning_rate: parseFloat(document.getElementById('sa-labor-scanning').value),
        tax_percent: parseFloat(document.getElementById('sa-tax-percent').value),
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
        const providerInput = row.querySelector('.sa-mach-provider');
        const enclosedInput = row.querySelector('.sa-mach-enclosed');
        if (powerInput && premiumInput) {
            const id = powerInput.getAttribute('data-id');
            const name = row.querySelector('td').innerText;
            machinesPayload.push({
                id: id,
                name: name,
                provider: providerInput ? providerInput.value.trim() : '',
                power_watts: parseFloat(powerInput.value),
                flat_premium: parseFloat(premiumInput.value),
                enclosed: enclosedInput ? enclosedInput.checked : false
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
        
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
        
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No user accounts registered yet.</td></tr>`;
        return;
    }
    
    users.forEach(u => {
        const row = document.createElement('tr');
        const date = u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A';
        
        row.innerHTML = `
            <td>${u.id}</td>
            <td style="font-weight: 700;">${escapeHtml(u.username)}</td>
            <td>${escapeHtml(u.email || '')}</td>
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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
        if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
        }
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

// Rate Limiting timer & helpers
let rateLimitInterval = null;
function handleRateLimit(waitSecs) {
    if (rateLimitInterval) clearInterval(rateLimitInterval);
    
    const overlay = document.getElementById('rate-limit-overlay');
    const timerSpan = document.getElementById('rate-limit-timer');
    const fileInput = document.getElementById('stl-file-input');
    const uploadZone = document.getElementById('upload-zone');
    
    if (overlay && timerSpan) {
        overlay.classList.remove('hidden');
        if (uploadZone) uploadZone.classList.add('rate-limited');
        if (fileInput) fileInput.disabled = true;
        
        let remaining = waitSecs;
        timerSpan.innerText = remaining;
        
        rateLimitInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(rateLimitInterval);
                rateLimitInterval = null;
                overlay.classList.add('hidden');
                if (uploadZone) uploadZone.classList.remove('rate-limited');
                if (fileInput) fileInput.disabled = false;
                
                resetPublicEstimator();
            } else {
                timerSpan.innerText = remaining;
            }
        }, 1000);
    }
    showToast(`Rate limit reached. Please wait ${waitSecs} seconds before uploading.`, 'error');
}

// Custom Settings Customization
function deleteLocalMaterial(id) {
    if (materials.length <= 1) {
        showToast('You must keep at least one filament.', 'error');
        return;
    }
    const mat = materials.find(m => m.id === id);
    if (!mat) return;
    if (confirm(`Are you sure you want to delete filament '${mat.name}'?`)) {
        materials = materials.filter(m => m.id !== id);
        populateSettingsFields({
            global_settings: getLocalGlobalSettings(),
            materials: materials,
            machines: machines
        });
    }
}

function deleteLocalMachine(id) {
    if (machines.length <= 1) {
        showToast('You must keep at least one machine.', 'error');
        return;
    }
    const mach = machines.find(m => m.id === id);
    if (!mach) return;
    if (confirm(`Are you sure you want to delete machine '${mach.name}'?`)) {
        machines = machines.filter(m => m.id !== id);
        populateSettingsFields({
            global_settings: getLocalGlobalSettings(),
            materials: materials,
            machines: machines
        });
    }
}

function getLocalGlobalSettings() {
    return {
        electricity_rate: parseFloat(document.getElementById('cfg-electricity').value || 0),
        wear_tear_percent: parseFloat(document.getElementById('cfg-wear-tear').value || 0),
        margin_percent: parseFloat(document.getElementById('cfg-margin').value || 0),
        labor_rate_hourly: parseFloat(document.getElementById('cfg-labor').value || 0),
        infill_ratio: parseFloat(document.getElementById('cfg-infill').value || 0),
        support_buffer_percent: parseFloat(document.getElementById('cfg-support').value || 0)
    };
}

function setupCustomButtons() {
    // Modal Elements
    const filamentModal = document.getElementById('add-filament-modal');
    const closeFilamentModal = document.getElementById('close-add-filament-modal');
    const cancelFilamentBtn = document.getElementById('cancel-add-filament-btn');
    const filamentForm = document.getElementById('add-filament-form');
    
    const machineModal = document.getElementById('add-machine-modal');
    const closeMachineModal = document.getElementById('close-add-machine-modal');
    const cancelMachineBtn = document.getElementById('cancel-add-machine-btn');
    const machineForm = document.getElementById('add-machine-form');

    // Helper to close modals
    const closeFilament = () => {
        if (filamentModal) filamentModal.classList.add('hidden');
        if (filamentForm) filamentForm.reset();
    };
    
    const closeMachine = () => {
        if (machineModal) machineModal.classList.add('hidden');
        if (machineForm) machineForm.reset();
    };

    // Close listeners
    if (closeFilamentModal) closeFilamentModal.addEventListener('click', closeFilament);
    if (cancelFilamentBtn) cancelFilamentBtn.addEventListener('click', closeFilament);
    if (closeMachineModal) closeMachineModal.addEventListener('click', closeMachine);
    if (cancelMachineBtn) cancelMachineBtn.addEventListener('click', closeMachine);

    // Open Filament Modal (Dev & SA)
    const addMatBtn = document.getElementById('add-material-btn');
    if (addMatBtn) {
        addMatBtn.addEventListener('click', () => {
            addModalMode = 'dev';
            if (filamentModal) filamentModal.classList.remove('hidden');
        });
    }
    
    const saAddMatBtn = document.getElementById('sa-add-material-btn');
    if (saAddMatBtn) {
        saAddMatBtn.addEventListener('click', () => {
            addModalMode = 'sa';
            if (filamentModal) filamentModal.classList.remove('hidden');
        });
    }

    // Open Machine Modal (Dev & SA)
    const addMachBtn = document.getElementById('add-machine-btn');
    if (addMachBtn) {
        addMachBtn.addEventListener('click', () => {
            addModalMode = 'dev';
            if (machineModal) machineModal.classList.remove('hidden');
        });
    }
    
    const saAddMachBtn = document.getElementById('sa-add-machine-btn');
    if (saAddMachBtn) {
        saAddMachBtn.addEventListener('click', () => {
            addModalMode = 'sa';
            if (machineModal) machineModal.classList.remove('hidden');
        });
    }

    // Form Submission: Add Filament
    if (filamentForm) {
        filamentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('new-filament-name');
            if (!nameInput) return;
            const name = nameInput.value.trim().toUpperCase();
            if (!name) return;
            
            const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            
            if (addModalMode === 'dev') {
                if (materials.some(m => m.id === id)) {
                    showToast(`Filament '${name}' already exists.`, 'error');
                    return;
                }
                materials.push({
                    id: id,
                    name: name,
                    density_g_cm3: 1.24,
                    price_per_kg: 60.0
                });
                populateSettingsFields({
                    global_settings: getLocalGlobalSettings(),
                    materials: materials,
                    machines: machines
                });
            } else {
                if (saMaterials.some(m => m.id === id)) {
                    showToast(`Filament '${name}' already exists.`, 'error');
                    return;
                }
                saMaterials.push({
                    id: id,
                    name: name,
                    density_g_cm3: 1.24,
                    price_per_kg: 60.0
                });
                renderSaMaterialsAndMachines(saMaterials, saMachines);
            }
            
            closeFilament();
            showToast(`Filament '${name}' added. Click Save to persist changes.`, 'warning');
        });
    }

    // Form Submission: Add Machine
    if (machineForm) {
        machineForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('new-machine-name');
            const providerInput = document.getElementById('new-machine-provider');
            const enclosedInput = document.getElementById('new-machine-enclosed');
            if (!nameInput || !providerInput) return;
            
            const name = nameInput.value.trim();
            const provider = providerInput.value.trim();
            if (!name || !provider) return;
            
            const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const isEnclosed = enclosedInput ? enclosedInput.checked : false;
            
            if (addModalMode === 'dev') {
                if (machines.some(m => m.id === id)) {
                    showToast(`Machine '${name}' already exists.`, 'error');
                    return;
                }
                machines.push({
                    id: id,
                    name: name,
                    provider: provider,
                    power_watts: 200.0,
                    flat_premium: 0.0,
                    enclosed: isEnclosed
                });
                populateSettingsFields({
                    global_settings: getLocalGlobalSettings(),
                    materials: materials,
                    machines: machines
                });
            } else {
                if (saMachines.some(m => m.id === id)) {
                    showToast(`Machine '${name}' already exists.`, 'error');
                    return;
                }
                saMachines.push({
                    id: id,
                    name: name,
                    provider: provider,
                    power_watts: 200.0,
                    flat_premium: 0.0,
                    enclosed: isEnclosed
                });
                renderSaMaterialsAndMachines(saMaterials, saMachines);
            }
            
            closeMachine();
            showToast(`Machine '${name}' added. Click Save to persist changes.`, 'warning');
        });
    }
}

function renderSaMaterialsAndMachines(mats, machs) {
    const matTbody = document.getElementById('sa-materials-tbody');
    if (matTbody) {
        matTbody.innerHTML = '';
        mats.forEach(mat => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-weight: 700;">${escapeHtml(mat.name)}</td>
                <td><input type="number" step="0.01" class="tbl-input sa-mat-density" data-id="${mat.id}" value="${mat.density_g_cm3}"></td>
                <td><input type="number" step="1" class="tbl-input sa-mat-price" data-id="${mat.id}" value="${mat.price_per_kg}"></td>
                <td style="text-align: center;">
                    <button type="button" class="tbl-btn btn-danger sa-delete-material-btn" data-id="${mat.id}" title="Delete Filament" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            matTbody.appendChild(row);
        });
        
        matTbody.querySelectorAll('.sa-delete-material-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                deleteSaLocalMaterial(id);
            });
        });
    }
    
    const machTbody = document.getElementById('sa-machines-tbody');
    if (machTbody) {
        machTbody.innerHTML = '';
        machs.forEach(mach => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-weight: 700;">${escapeHtml(mach.name)}</td>
                <td><input type="text" class="tbl-input sa-mach-provider" data-id="${mach.id}" value="${escapeHtml(mach.provider || '')}" placeholder="e.g. Bambulab"></td>
                <td><input type="number" step="10" class="tbl-input sa-mach-power" data-id="${mach.id}" value="${mach.power_watts}"></td>
                <td><input type="number" step="1" class="tbl-input sa-mach-premium" data-id="${mach.id}" value="${mach.flat_premium}"></td>
                <td style="text-align: center;">
                    <input type="checkbox" class="sa-mach-enclosed" data-id="${mach.id}" ${mach.enclosed ? 'checked' : ''} style="cursor: pointer; width: auto; transform: scale(1.1);">
                </td>
                <td style="text-align: center;">
                    <button type="button" class="tbl-btn btn-danger sa-delete-machine-btn" data-id="${mach.id}" title="Delete Machine" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            machTbody.appendChild(row);
        });
        
        machTbody.querySelectorAll('.sa-delete-machine-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                deleteSaLocalMachine(id);
            });
        });
    }
}

function deleteSaLocalMaterial(id) {
    if (saMaterials.length <= 1) {
        showToast('You must keep at least one filament.', 'error');
        return;
    }
    const mat = saMaterials.find(m => m.id === id);
    if (!mat) return;
    if (confirm(`Are you sure you want to delete filament '${mat.name}' globally?`)) {
        saMaterials = saMaterials.filter(m => m.id !== id);
        renderSaMaterialsAndMachines(saMaterials, saMachines);
    }
}

function deleteSaLocalMachine(id) {
    if (saMachines.length <= 1) {
        showToast('You must keep at least one machine.', 'error');
        return;
    }
    const mach = saMachines.find(m => m.id === id);
    if (!mach) return;
    if (confirm(`Are you sure you want to delete machine '${mach.name}' globally?`)) {
        saMachines = saMachines.filter(m => m.id !== id);
        renderSaMaterialsAndMachines(saMaterials, saMachines);
    }
}

// Configuration State Checks and Warning Modal
function checkConfigurationState() {
    const isConfigured = materials && materials.length > 0 && 
                        machines && machines.length > 0 && 
                        globalSettings && Object.keys(globalSettings).length > 0;
                        
    const configModal = document.getElementById('configure-estimator-modal');
    if (!configModal) return;
    
    // Get the current active tab ID
    const activeTabBtn = document.querySelector('.nav-btn.active');
    const activeTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : '';
    
    // Only show warning if we are on the public estimator tab and the system is not configured
    if (!isConfigured && activeTab === 'public-tab') {
        configModal.classList.remove('hidden');
    } else {
        configModal.classList.add('hidden');
    }
}

function setupConfigureEstimatorModal() {
    const configAdminBtn = document.getElementById('config-goto-admin-btn');
    if (configAdminBtn) {
        configAdminBtn.addEventListener('click', () => {
            // Hide the configuration modal
            const configModal = document.getElementById('configure-estimator-modal');
            if (configModal) {
                configModal.classList.add('hidden');
            }
            
            // Switch to Super Admin tab
            const superadminBtn = document.getElementById('nav-superadmin-btn');
            if (superadminBtn) {
                superadminBtn.click();
            }
        });
    }
    
    const configCloseBtn = document.getElementById('config-modal-close');
    if (configCloseBtn) {
        configCloseBtn.addEventListener('click', () => {
            const configModal = document.getElementById('configure-estimator-modal');
            if (configModal) {
                configModal.classList.add('hidden');
            }
        });
    }
}

