import gsap from 'gsap';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const state = {
  pins: [],
  user: null,
  authMode: 'login',
  query: '',
  category: 'Todos',
  view: 'all',
  draftFile: null,
  loading: false
};

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('masonry-grid');
  const searchInput = document.getElementById('search-input');
  const createModal = document.getElementById('create-modal');
  const createForm = document.getElementById('create-form');
  const imageInput = document.getElementById('image-input');
  const imagePreview = document.getElementById('image-preview');
  const uploadEmpty = document.getElementById('upload-empty');
  const dropzone = document.getElementById('dropzone');
  const titleInput = document.getElementById('title-input');
  const accountButton = document.getElementById('account-button');
  const authModal = document.getElementById('auth-modal');
  const authForm = document.getElementById('auth-form');
  const authMessage = document.getElementById('auth-message');
  const profileModal = document.getElementById('profile-modal');
  const profileForm = document.getElementById('profile-form');
  const profileMessage = document.getElementById('profile-message');
  const profileAvatarInput = document.getElementById('profile-avatar-input');
  const profileAvatarPreview = document.getElementById('profile-avatar-preview');
  const logoutButton = document.getElementById('logout-button');

  runIntroAnimation();
  boot(grid);

  searchInput.addEventListener('input', debounce((event) => {
    state.query = event.target.value.trim();
    loadPins(grid);
  }, 250));

  document.querySelectorAll('[data-open-create]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (!state.user) {
        openAuthModal(authModal, 'login');
        return;
      }

      openCreateModal(createModal, titleInput);
    });
  });

  document.querySelector('[data-close-create]').addEventListener('click', () => {
    closeCreateModal(createModal, createForm, imagePreview, uploadEmpty);
  });

  createModal.addEventListener('click', (event) => {
    if (event.target === createModal) {
      closeCreateModal(createModal, createForm, imagePreview, uploadEmpty);
    }
  });

  accountButton.addEventListener('click', async () => {
    if (!state.user) {
      openAuthModal(authModal, 'login');
      return;
    }

    openProfileModal(profileModal);
  });

  logoutButton.addEventListener('click', async () => {
    await logout();
    closeProfileModal(profileModal, profileForm, profileMessage);
    await boot(grid);
  });

  document.querySelector('[data-close-profile]').addEventListener('click', () => {
    closeProfileModal(profileModal, profileForm, profileMessage);
  });

  profileModal.addEventListener('click', (event) => {
    if (event.target === profileModal) {
      closeProfileModal(profileModal, profileForm, profileMessage);
    }
  });

  profileAvatarInput.addEventListener('change', () => {
    const [file] = profileAvatarInput.files;
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      profileAvatarPreview.src = reader.result;
    });
    reader.readAsDataURL(file);
  });

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const [file] = profileAvatarInput.files;
    if (!file) {
      profileMessage.textContent = 'Elige una imagen primero.';
      return;
    }

    const submitButton = profileForm.querySelector('.submit-pin');
    submitButton.disabled = true;
    profileMessage.textContent = '';

    try {
      const formData = new FormData(profileForm);
      const result = await updateAvatar(formData);
      state.user = result.user;
      updateAccountButton();
      hydrateProfileModal();
      await loadPins(grid);
      profileMessage.textContent = 'Foto actualizada.';
    } catch (error) {
      profileMessage.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  document.querySelector('[data-close-auth]').addEventListener('click', () => {
    closeAuthModal(authModal, authForm, authMessage);
  });

  authModal.addEventListener('click', (event) => {
    if (event.target === authModal) {
      closeAuthModal(authModal, authForm, authMessage);
    }
  });

  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setAuthMode(button.dataset.authMode);
    });
  });

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = authForm.querySelector('.submit-pin');
    submitButton.disabled = true;
    authMessage.textContent = '';

    try {
      const formData = Object.fromEntries(new FormData(authForm));
      const payload = state.authMode === 'login'
        ? { email: formData.email, password: formData.password }
        : formData;
      const result = state.authMode === 'login'
        ? await login(payload)
        : await register(payload);

      state.user = result.user;
      updateAccountButton();
      closeAuthModal(authModal, authForm, authMessage);
      await loadPins(grid);
    } catch (error) {
      authMessage.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  imageInput.addEventListener('change', () => {
    const [file] = imageInput.files;
    if (file) previewImage(file, imagePreview, uploadEmpty);
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('dragging');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragging');
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragging');
    const [file] = event.dataTransfer.files;
    if (file?.type.startsWith('image/')) previewImage(file, imagePreview, uploadEmpty);
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.draftFile) {
      dropzone.classList.add('needs-image');
      setTimeout(() => dropzone.classList.remove('needs-image'), 700);
      return;
    }

    const submitButton = createForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.querySelector('span').textContent = 'Publicando...';

    try {
      await createPin(new FormData(createForm));
      closeCreateModal(createModal, createForm, imagePreview, uploadEmpty);
      setView('all');
      await loadPins(grid);
    } catch (error) {
      showError(grid, error.message);
    } finally {
      submitButton.disabled = false;
      submitButton.querySelector('span').textContent = 'Publicar';
    }
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.category = chip.dataset.category;
      document.querySelectorAll('.chip').forEach((item) => item.classList.remove('active'));
      chip.classList.add('active');
      loadPins(grid);
    });
  });

  document.querySelectorAll('[data-view]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      setView(item.dataset.view);
      loadPins(grid);
    });
  });

grid.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    const card = event.target.closest('.pin-card');

    if (!card) return;

    if (!actionButton) {
      const pin = state.pins.find((item) => item.id === card.dataset.id);
      if (pin) openPinModal(pin);
      return;
    }

    event.stopPropagation();
    const pin = state.pins.find((item) => item.id === card.dataset.id);
    if (!pin) return;

    try {
      if (actionButton.dataset.action === 'save') {
        if (!ensureUser(authModal)) return;
        await updateReaction(pin.id, { saved: !pin.saved });
      }

      if (actionButton.dataset.action === 'like') {
        if (!ensureUser(authModal)) return;
        await updateReaction(pin.id, { liked: !pin.liked });
      }

      if (actionButton.dataset.action === 'delete' && pin.local) {
        await deletePin(pin.id);
      }

      await loadPins(grid);
    } catch (error) {
      showError(grid, error.message);
    }
  });
});

async function boot(grid) {
  const payload = await getCurrentUser();
  state.user = payload.user;
  updateAccountButton();
  await loadPins(grid);
}

async function loadPins(grid) {
  state.loading = true;
  renderPins(grid);

  try {
    const params = new URLSearchParams({
      query: state.query,
      category: state.category,
      view: state.view
    });
    const response = await fetch(`${API_BASE}/api/pins?${params}`, { credentials: 'include' });
    const payload = await parseResponse(response);
    state.pins = payload.pins;
    renderPins(grid);
  } catch (error) {
    showError(grid, error.message);
  } finally {
    state.loading = false;
  }
}

async function createPin(formData) {
  if (state.draftFile) {
    formData.set('image', state.draftFile);
  }

  const response = await fetch(`${API_BASE}/api/pins`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });

  return parseResponse(response);
}

async function updateReaction(id, body) {
  const response = await fetch(`${API_BASE}/api/pins/${id}/reactions`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  return parseResponse(response);
}

async function deletePin(id) {
  const response = await fetch(`${API_BASE}/api/pins/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (response.status === 204) return null;
  return parseResponse(response);
}

async function getCurrentUser() {
  const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
  return parseResponse(response);
}

async function login(body) {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function register(body) {
  const response = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function logout() {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  });
  state.user = null;
}

async function updateAvatar(formData) {
  const response = await fetch(`${API_BASE}/api/users/me/avatar`, {
    method: 'PATCH',
    credentials: 'include',
    body: formData
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  if (response.ok) {
    if (response.status === 204) return null;
    return response.json();
  }

  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.error || 'No se pudo completar la acción.');
}

function renderPins(grid) {
  if (state.loading && !state.pins.length) {
    grid.innerHTML = `
      <section class="empty-state">
        <i class="ph ph-circle-notch"></i>
        <h3>Cargando pins</h3>
        <p>Conectando con la base de datos.</p>
      </section>
    `;
    return;
  }

  grid.innerHTML = state.pins.length ? state.pins.map(createPinCard).join('') : `
    <section class="empty-state">
      <i class="ph ph-images-square"></i>
      <h3>No hay pins para mostrar</h3>
      <p>Prueba otra búsqueda o sube una imagen nueva.</p>
    </section>
  `;

  requestAnimationFrame(() => {
    gsap.to('.pin-card', {
      y: 0,
      opacity: 1,
      duration: 0.55,
      stagger: 0.025,
      ease: 'power3.out'
    });
  });
}

function createPinCard(pin) {
  return `
    <article class="pin-card" data-id="${pin.id}">
      <div class="pin-image-wrapper">
        <img src="${resolveAssetUrl(pin.url)}" alt="${escapeHtml(pin.title)}" class="pin-image" loading="lazy" />
        <div class="pin-overlay">
          <div class="pin-header">
            <button class="save-btn ${pin.saved ? 'active' : ''}" data-action="save">
              ${pin.saved ? 'Guardado' : 'Guardar'}
            </button>
          </div>
          <div class="pin-footer">
            <div class="pin-info">
              <span class="pin-category">${escapeHtml(pin.category)}</span>
              <h3 class="pin-title">${escapeHtml(pin.title)}</h3>
              <div class="pin-author">
                <img src="${escapeHtml(pin.avatar)}" alt="" class="author-avatar">
                <span>${escapeHtml(pin.author)}</span>
              </div>
            </div>
            <div class="pin-actions">
              <button class="icon-btn ${pin.liked ? 'active' : ''}" data-action="like" aria-label="Me gusta">
                <i class="${pin.liked ? 'ph-fill' : 'ph'} ph-heart"></i>
              </button>
              ${pin.local ? `
                <button class="icon-btn danger" data-action="delete" aria-label="Eliminar">
                  <i class="ph ph-trash"></i>
                </button>
              ` : `
                <button class="icon-btn" data-action="save" aria-label="Guardar en tablero">
                  <i class="ph-fill ph-bookmark-simple"></i>
                </button>
              `}
            </div>
          </div>
        </div>
      </div>
    </article>
  `;
}

function previewImage(file, imagePreview, uploadEmpty) {
  state.draftFile = file;
  const reader = new FileReader();

  reader.addEventListener('load', () => {
    imagePreview.src = reader.result;
    imagePreview.classList.add('visible');
    uploadEmpty.classList.add('hidden');
  });

  reader.readAsDataURL(file);
}

function openCreateModal(modal, firstInput) {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => firstInput.focus());

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      document.getElementById('input-lat').value = latitude;
      document.getElementById('input-lng').value = longitude;
      reverseMunicipio(latitude, longitude);
    });
  }
}

async function reverseMunicipio(lat, lng) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`
    );
    const data = await response.json();
    const municipio = data.address?.county || data.address?.municipality || data.address?.city || 'Estado de México';
    document.getElementById('input-municipio').value = municipio;
  } catch {
    document.getElementById('input-municipio').value = 'Estado de México';
  }
}
function openAuthModal(modal, mode) {
  setAuthMode(mode);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => document.getElementById('auth-email').focus());
}

function closeAuthModal(modal, form, message) {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  form.reset();
  message.textContent = '';
}

function openProfileModal(modal) {
  hydrateProfileModal();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeProfileModal(modal, form, message) {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  form.reset();
  message.textContent = '';
  hydrateProfileModal();
}

function hydrateProfileModal() {
  if (!state.user) return;

  document.getElementById('profile-avatar-preview').src = resolveAssetUrl(state.user.avatar);
  document.getElementById('profile-name').textContent = state.user.name;
  document.getElementById('profile-email').textContent = state.user.email;
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authMode === mode);
  });
  document.querySelector('.auth-modal').classList.toggle('register-mode', mode === 'register');
  document.querySelector('#auth-form .submit-pin span').textContent = mode === 'register' ? 'Crear cuenta' : 'Entrar';
  document.getElementById('auth-title').textContent = mode === 'register' ? 'Crea tu cuenta' : 'Entra a Kromos';
}

function closeCreateModal(modal, form, imagePreview, uploadEmpty) {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  form.reset();
  state.draftFile = null;
  imagePreview.removeAttribute('src');
  imagePreview.classList.remove('visible');
  uploadEmpty.classList.remove('hidden');
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });
}

function ensureUser(authModal) {
  if (!state.user) {
    openAuthModal(authModal, 'login');
    return false;
  }

  return true;
}

function updateAccountButton() {
  const avatar = document.querySelector('#account-button .avatar');
  if (!avatar) return;

  avatar.src = state.user?.avatar ? resolveAssetUrl(state.user.avatar) : 'https://i.pravatar.cc/150?img=68';
  avatar.alt = state.user ? `Cuenta de ${state.user.name}` : 'Iniciar sesión';
  document.getElementById('account-button').title = state.user ? 'Cerrar sesión' : 'Iniciar sesión';
}

function showError(grid, message) {
  grid.innerHTML = `
    <section class="empty-state">
      <i class="ph ph-warning-circle"></i>
      <h3>No se pudo cargar</h3>
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

function resolveAssetUrl(url) {
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}

function runIntroAnimation() {
  requestAnimationFrame(() => {
    gsap.from('.sidebar', {
      x: -50,
      opacity: 0,
      duration: 0.8,
      ease: 'power3.out'
    });

    gsap.from('.topbar', {
      y: -30,
      opacity: 0,
      duration: 0.8,
      delay: 0.2,
      ease: 'power3.out'
    });

    gsap.from('.chip', {
      y: 20,
      opacity: 0,
      duration: 0.5,
      stagger: 0.05,
      delay: 0.4,
      ease: 'back.out(1.5)'
    });
  });
}

function debounce(callback, wait) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function openPinModal(pin) {
  const modal = document.getElementById('pin-modal');
  document.getElementById('pin-detail-img').src = resolveAssetUrl(pin.url);
  document.getElementById('pin-detail-title').textContent = pin.title;
  document.getElementById('pin-detail-author').textContent = pin.author;
  document.getElementById('pin-detail-municipio').textContent = pin.municipio || 'Sin ubicación registrada';

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  setTimeout(async () => {
    if (window._pinMap) {
      window._pinMap.remove();
      window._pinMap = null;
    }

    const map = L.map('pin-map', { zoomControl: true });
    window._pinMap = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    if (pin.latitude && pin.longitude) {
      map.setView([pin.latitude, pin.longitude], 11);
      L.marker([pin.latitude, pin.longitude]).addTo(map).bindPopup(pin.municipio || pin.title).openPopup();

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(pin.municipio + ', Estado de México, México')}&format=json&polygon_geojson=1&limit=1`
        );
        const data = await res.json();
        if (data[0]?.geojson) {
          L.geoJSON(data[0].geojson, {
            style: {
              color: '#1ed760',
              weight: 2,
              fillColor: '#1ed760',
              fillOpacity: 0.15
            },
            pointToLayer: () => null
          }).addTo(map);
        }
      } catch {
        // Si falla el polígono, solo se muestra el marcador
      }
    } else {
      map.setView([19.2965, -99.6562], 8);
    }
  }, 100);

  document.getElementById('close-pin-modal').onclick = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (window._pinMap) { window._pinMap.remove(); window._pinMap = null; }
  };

  modal.onclick = (event) => {
    if (event.target === modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      if (window._pinMap) { window._pinMap.remove(); window._pinMap = null; }
    }
  };
}