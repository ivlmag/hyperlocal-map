(function () {
  'use strict';

  const MOSCOW = [55.7558, 37.6173];
  const state = {
    map: null,
    marker: null,
    records: new Map(),
    loading: false,
    lastMapClickAt: -Infinity,
    userLocationMarker: null,
    userAccuracyCircle: null,
    userLocationCentered: false,
    geolocationWatchId: null
  };
  const $ = (id) => document.getElementById(id);

  function streetKey(value) {
    return String(value || '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е')
      .replace(/^(улица|ул\.?|переулок|пер\.?|проспект|пр-т|шоссе|набережная|наб\.?|площадь|пл\.?|бульвар|бул\.?|проезд|тупик|аллея)\s+/i, '')
      .replace(/[^0-9a-zа-яё]+/gi, ' ')
      .replace(/\s+(улица|ул|переулок|пер|проспект|просп|пр т|шоссе|ш|набережная|наб|площадь|пл|бульвар|бул|проезд|тупик|аллея)$/i, '')
      .replace(/\s+/g, ' ').trim();
  }

  function splitHouse(value) {
    const text = String(value || '').trim();
    let match = text.match(/^(.+?)\s+(?:с|стр\.?|строение)\s*([\w/-]+)$/i);
    if (match) return { house: match[1].trim(), structure: match[2].trim(), corpus: '', ownership: '' };
    match = text.match(/^(.+?)\s+(?:к|корп\.?|корпус)\s*([\w/-]+)$/i);
    if (match) return { house: match[1].trim(), structure: '', corpus: match[2].trim(), ownership: '' };
    return { house: text, structure: '', corpus: '', ownership: '' };
  }

  function recordKey(street, house) {
    const parts = splitHouse(house);
    return [streetKey(street), parts.house, parts.structure, parts.corpus, parts.ownership].join('\u001f');
  }

  function normalisePhotoCrop(value) {
    try {
      const crop = typeof value === 'string' ? JSON.parse(value) : value;
      const left = Number(crop.left); const top = Number(crop.top);
      const right = Number(crop.right); const bottom = Number(crop.bottom);
      if (left >= 0 && top >= 0 && right <= 1 && bottom <= 1 && right > left && bottom > top) {
        return { left, top, right, bottom };
      }
    } catch (_) { /* Old exports may not contain a crop. */ }
    return null;
  }

  function renderInfoPhoto(url, rawCrop) {
    const wrap = $('info-photo-wrap');
    const photo = $('info-photo');
    const crop = normalisePhotoCrop(rawCrop);
    state.currentPhoto = url ? { url, crop } : null;
    photo.onload = null; photo.onerror = null;
    wrap.className = 'info-photo-wrap hidden';
    wrap.removeAttribute('style');
    photo.removeAttribute('style');
    if (!url) { photo.removeAttribute('src'); return; }

    wrap.classList.remove('hidden');
    photo.dataset.photoUrl = url;
    photo.alt = 'Фото здания';
    photo.onerror = () => {
      if (photo.dataset.photoUrl === url) wrap.classList.add('hidden');
    };
    photo.onload = () => {
      if (photo.dataset.photoUrl !== url) return;
      // Без выбранного кадра показываем исходное фото целиком. При наличии
      // кадра выводим ровно выделенный пользователем прямоугольник — без
      // дополнительной автоматической обрезки.
      if (!crop) return;
      const cropWidth = crop.right - crop.left;
      const cropHeight = crop.bottom - crop.top;
      // clientWidth самого блока — это фактическая ширина внутри отступов
      // карточки. Родительская clientWidth была больше и выпускала фото наружу.
      let viewportWidth = wrap.clientWidth;
      // Пропорции выбранного прямоугольника зависят и от исходного фото.
      // Так его высота точно заканчивается у нижней границы кадра, без пустоты.
      let viewportHeight = viewportWidth * cropHeight * photo.naturalHeight / (cropWidth * photo.naturalWidth);
      const maxHeight = 360;
      if (viewportHeight > maxHeight) {
        viewportHeight = maxHeight;
        viewportWidth = viewportHeight * cropWidth / cropHeight;
      }
      const imageWidth = viewportWidth / cropWidth;
      const imageHeight = imageWidth * photo.naturalHeight / photo.naturalWidth;
      wrap.classList.add('is-cropped');
      wrap.style.width = `${Math.round(viewportWidth)}px`;
      wrap.style.height = `${Math.round(viewportHeight)}px`;
      photo.style.width = `${Math.round(imageWidth)}px`;
      photo.style.height = `${Math.round(imageHeight)}px`;
      photo.style.left = `${Math.round(-crop.left * imageWidth)}px`;
      photo.style.top = `${Math.round(-crop.top * imageHeight)}px`;
    };
    photo.src = url;
  }

  function appendInlineMarkup(element, value) {
    const fragments = String(value || '').split(/(\*\*[^*]+\*\*)/g);
    for (const fragment of fragments) {
      if (fragment.startsWith('**') && fragment.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = fragment.slice(2, -2);
        element.append(strong);
      } else element.append(document.createTextNode(fragment));
    }
  }

  function renderArticleMarkup(value) {
    const container = $('article-content');
    container.replaceChildren();
    let list = null;
    for (const rawLine of String(value || '').replace(/\r\n/g, '\n').split('\n')) {
      const line = rawLine.trim();
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const bullet = line.match(/^[-*]\s+(.+)$/);
      const numbered = line.match(/^\d+[.)]\s+(.+)$/);
      if (heading) {
        list = null;
        const tag = heading[1].length === 1 ? 'h2' : 'h3';
        const node = document.createElement(tag); appendInlineMarkup(node, heading[2]); container.append(node); continue;
      }
      if (bullet || numbered) {
        const tag = numbered ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== tag) { list = document.createElement(tag); container.append(list); }
        const item = document.createElement('li'); appendInlineMarkup(item, (bullet || numbered)[1]); list.append(item); continue;
      }
      list = null;
      if (!line) continue;
      const paragraph = document.createElement('p'); appendInlineMarkup(paragraph, rawLine); container.append(paragraph);
    }
  }

  function openFullArticle() {
    if (!state.currentArticle?.text?.trim()) return;
    $('article-title').textContent = state.currentArticle.title;
    renderArticleMarkup(state.currentArticle.text);
    $('article-view').classList.remove('is-hidden');
    $('article-view').setAttribute('aria-hidden', 'false');
  }

  function closeFullArticle() {
    $('article-view').classList.add('is-hidden');
    $('article-view').setAttribute('aria-hidden', 'true');
  }

  function setInfo(title, text, withImage, photoUrl = '', photoCrop = '', fullArticle = '') {
    const card = $('info-card');
    card.classList.remove('is-hidden');
    card.setAttribute('aria-hidden', 'false');
    $('info-title').textContent = title;
    $('info-text').textContent = text;
    $('info-image').classList.toggle('hidden', !withImage);
    state.currentArticle = String(fullArticle || '').trim() ? { title, text: String(fullArticle) } : null;
    $('info-article').classList.toggle('hidden', !state.currentArticle);
    renderInfoPhoto(photoUrl, photoCrop);
  }

  async function reverse(lat, lon) {
    const params = new URLSearchParams({ format: 'jsonv2', lat, lon, zoom: '18', layer: 'address', addressdetails: '1', 'accept-language': 'ru' });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
    return response.ok ? response.json() : null;
  }

  function lookup(street, house) {
    return state.records.get(recordKey(street, house)) || null;
  }

  function userLocationIcon() {
    return L.icon({
      iconUrl: './assets/user-location.png',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      className: 'user-location-marker'
    });
  }

  function updateUserLocation(position) {
    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const accuracy = Math.max(1, Number(position.coords.accuracy) || 1);
    const coordinates = [latitude, longitude];

    if (state.userLocationMarker) state.userLocationMarker.setLatLng(coordinates);
    else state.userLocationMarker = L.marker(coordinates, {
      icon: userLocationIcon(),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000
    }).addTo(state.map);

    if (state.userAccuracyCircle) state.userAccuracyCircle.setLatLng(coordinates).setRadius(accuracy);
    else state.userAccuracyCircle = L.circle(coordinates, {
      radius: accuracy,
      interactive: false,
      color: '#27675b',
      weight: 1,
      opacity: 0.35,
      fillColor: '#27675b',
      fillOpacity: 0.08
    }).addTo(state.map);

    if (!state.userLocationCentered) {
      state.map.setView(coordinates, 18, { animate: true });
      state.userLocationCentered = true;
    }
  }

  function startUserGeolocation() {
    if (!navigator.geolocation) return;
    state.geolocationWatchId = navigator.geolocation.watchPosition(
      updateUserLocation,
      () => { /* Permission can be declined; the map remains fully usable. */ },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }

  function showAddress(street, house, fallbackName) {
    const record = lookup(street, house);
    const address = record?.address || [street, house].filter(Boolean).join(', ') || fallbackName || 'Адрес не распознан';
    if (record) {
      const text = record.help_text.trim() || 'Запись найдена в локальной БД.\n\nСправка для этого адреса пока не заполнена.';
      setInfo(address, text, Boolean(record.help_text.trim()), record.photo_url, record.photo_crop, record.full_article);
    } else {
      setInfo(address, 'Для этого адреса записи в выгрузке нет.', false);
    }
  }

  async function handleClick(event) {
    const lat = Number(event.latlng.lat.toFixed(6));
    const lon = Number(event.latlng.lng.toFixed(6));
    state.marker?.remove();
    state.marker = L.marker([lat, lon], { icon: L.icon({ iconUrl: './help-image.png', iconSize: [30, 30], iconAnchor: [15, 27], popupAnchor: [0, -27] }) }).addTo(state.map);
    setInfo('Точка клика', 'Определяю адрес и ищу его в выгрузке…', false);
    try {
      if (event.resolvedAddress?.street && event.resolvedAddress?.house) {
        showAddress(event.resolvedAddress.street, event.resolvedAddress.house, '');
        return;
      }
      const payload = await reverse(lat, lon);
      const address = payload?.address || {};
      const street = String(address.road || address.pedestrian || address.residential || '').trim();
      const house = String(address.house_number || '').trim();
      if (street && house) showAddress(street, house, payload?.display_name);
      else setInfo('Точка клика', 'Кликните по контуру здания — адрес не определён.', false);
    } catch (_) {
      setInfo('Точка клика', 'Не удалось определить адрес. Проверьте подключение к сервису карт и попробуйте ещё раз.', false);
    }
  }

  async function search(event) {
    event.preventDefault();
    const query = $('search-input').value.trim();
    if (!query) return;
    setInfo('Поиск', 'Ищу адрес…', false);
    try {
      const params = new URLSearchParams({ format: 'jsonv2', q: query, limit: '1', addressdetails: '1', 'accept-language': 'ru', countrycodes: 'ru' });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      const results = response.ok ? await response.json() : [];
      const first = results[0];
      if (!first?.lat || !first.lon) throw new Error('not found');
      const address = first.address || {};
      const street = String(address.road || address.pedestrian || address.residential || '').trim();
      const house = String(address.house_number || '').trim();
      state.map.setView([Number(first.lat), Number(first.lon)], 17);
      await handleClick({ latlng: { lat: Number(first.lat), lng: Number(first.lon) }, resolvedAddress: { street, house } });
    } catch (_) { setInfo('Поиск', 'Адрес не найден. Уточните запрос.', false); }
  }

  function installTouchFallback() {
    const container = state.map.getContainer();
    let touchStart = null;
    container.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) { touchStart = null; return; }
      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });
    container.addEventListener('touchend', (event) => {
      if (!touchStart || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      const moved = Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y);
      touchStart = null;
      if (moved > 14) return;
      const point = { clientX: touch.clientX, clientY: touch.clientY };
      window.setTimeout(() => {
        if (performance.now() - state.lastMapClickAt < 700) return;
        const latlng = state.map.mouseEventToLatLng(point);
        handleClick({ latlng });
      }, 250);
    }, { passive: true });
  }

  async function loadData() {
    let data = window.HYPERLOCAL_DATA;
    if (!data) {
      const response = await fetch('./data/buildings.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('data');
      data = await response.json();
    }
    const streets = data.streets || [];
    for (const row of data.records || []) {
      const [streetIndex, house, structure, corpus, ownership, address, helpText, updatedAt, photoUrl, photoCrop, fullArticle] = row;
      state.records.set([streets[streetIndex] || '', house, structure, corpus, ownership].join('\u001f'), {
        address, help_text: helpText || '', updated_at: updatedAt || '',
        photo_url: photoUrl || '', photo_crop: photoCrop || '', full_article: fullArticle || ''
      });
    }
  }

  async function start() {
    if (!window.L) { setInfo('Карта', 'Не удалось загрузить библиотеку карты.', false); return; }
    state.map = L.map('map', { zoomControl: false, attributionControl: false }).setView(MOSCOW, 11);
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
    osm.addTo(state.map);
    state.map.on('click', (event) => {
      state.lastMapClickAt = performance.now();
      handleClick(event);
    });
    installTouchFallback();
    $('search-form').addEventListener('submit', search);
    $('info-close').addEventListener('click', () => {
      $('info-card').classList.add('is-hidden');
      $('info-card').setAttribute('aria-hidden', 'true');
    });
    $('info-article').addEventListener('click', openFullArticle);
    $('article-close').addEventListener('click', closeFullArticle);
    try { await loadData(); } catch (_) { /* Карта остаётся доступной даже без выгрузки. */ }
    startUserGeolocation();
  }

  start();
}());
