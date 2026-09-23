(function () {
  'use strict';

  // Стиль Liberty уже содержит официальный слой building-3d.
  const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const MOSCOW = [37.6173, 55.7558];
  const state = { map: null, marker: null, records: new Map(), userMarker: null, userCentered: false };
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
    const part = splitHouse(house);
    return [streetKey(street), part.house, part.structure, part.corpus, part.ownership].join('\u001f');
  }

  function parseCrop(value) {
    try {
      const crop = typeof value === 'string' ? JSON.parse(value) : value;
      if (Number(crop.left) >= 0 && Number(crop.top) >= 0 && Number(crop.right) <= 1 && Number(crop.bottom) <= 1 && Number(crop.right) > Number(crop.left) && Number(crop.bottom) > Number(crop.top)) return crop;
    } catch (_) {}
    return null;
  }

  function renderInfoPhoto(url, rawCrop) {
    const wrap = $('info-photo-wrap'), photo = $('info-photo'), crop = parseCrop(rawCrop);
    photo.onload = null; photo.onerror = null; wrap.className = 'info-photo-wrap hidden';
    wrap.removeAttribute('style'); photo.removeAttribute('style');
    if (!url) { photo.removeAttribute('src'); return; }
    wrap.classList.remove('hidden'); photo.dataset.photoUrl = url; photo.alt = 'Фото здания';
    photo.onerror = () => { if (photo.dataset.photoUrl === url) wrap.classList.add('hidden'); };
    photo.onload = () => {
      if (photo.dataset.photoUrl !== url || !crop) return;
      const cropWidth = Number(crop.right) - Number(crop.left), cropHeight = Number(crop.bottom) - Number(crop.top);
      let width = wrap.clientWidth, height = width * cropHeight * photo.naturalHeight / (cropWidth * photo.naturalWidth);
      if (height > 360) { height = 360; width = height * cropWidth / cropHeight; }
      const imageWidth = width / cropWidth, imageHeight = imageWidth * photo.naturalHeight / photo.naturalWidth;
      wrap.classList.add('is-cropped'); wrap.style.width = Math.round(width) + 'px'; wrap.style.height = Math.round(height) + 'px';
      photo.style.width = Math.round(imageWidth) + 'px'; photo.style.height = Math.round(imageHeight) + 'px';
      photo.style.left = Math.round(-Number(crop.left) * imageWidth) + 'px'; photo.style.top = Math.round(-Number(crop.top) * imageHeight) + 'px';
    };
    photo.src = url;
  }

  function setInfo(title, text, showHelpImage, photoUrl = '', photoCrop = '') {
    const card = $('info-card');
    card.classList.remove('is-hidden'); card.setAttribute('aria-hidden', 'false');
    $('info-title').textContent = title; $('info-text').textContent = text;
    $('info-image').classList.toggle('hidden', !showHelpImage);
    renderInfoPhoto(photoUrl, photoCrop);
  }

  function markerElement(imageUrl, className, width, height) {
    const element = document.createElement('div');
    element.className = className; element.style.width = width + 'px'; element.style.height = height + 'px';
    element.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '\\"') + '")';
    return element;
  }

  function addClickMarker(lng, lat) {
    state.marker?.remove();
    state.marker = new maplibregl.Marker({ element: markerElement('./help-image.png', 'map-pin', 30, 30), anchor: 'bottom' }).setLngLat([lng, lat]).addTo(state.map);
  }

  async function reverse(lat, lon) {
    const params = new URLSearchParams({ format: 'jsonv2', lat, lon, zoom: '18', layer: 'address', addressdetails: '1', 'accept-language': 'ru' });
    const response = await fetch('https://nominatim.openstreetmap.org/reverse?' + params);
    return response.ok ? response.json() : null;
  }

  function showAddress(street, house, fallbackName) {
    const record = state.records.get(recordKey(street, house));
    const address = record?.address || [street, house].filter(Boolean).join(', ') || fallbackName || 'Адрес не распознан';
    if (!record) return setInfo(address, 'Для этого адреса записи в выгрузке нет.', false);
    const text = record.help_text.trim() || 'Запись найдена в локальной БД.\n\nСправка для этого адреса пока не заполнена.';
    setInfo(address, text, Boolean(record.help_text.trim()), record.photo_url, record.photo_crop);
  }

  async function handleClick(lng, lat, resolvedAddress) {
    addClickMarker(lng, lat); setInfo('Точка клика', 'Определяю адрес и ищу его в выгрузке…', false);
    try {
      if (resolvedAddress?.street && resolvedAddress?.house) return showAddress(resolvedAddress.street, resolvedAddress.house, '');
      const payload = await reverse(lat, lng), address = payload?.address || {};
      const street = String(address.road || address.pedestrian || address.residential || '').trim(), house = String(address.house_number || '').trim();
      if (street && house) showAddress(street, house, payload?.display_name);
      else setInfo('Точка клика', 'Кликните по контуру здания — адрес не определён.', false);
    } catch (_) { setInfo('Точка клика', 'Не удалось определить адрес. Проверьте подключение к сервису карт и попробуйте ещё раз.', false); }
  }

  async function search(event) {
    event.preventDefault();
    const query = $('search-input').value.trim();
    if (!query) return;
    setInfo('Поиск', 'Ищу адрес…', false);
    try {
      const params = new URLSearchParams({ format: 'jsonv2', q: query, limit: '1', addressdetails: '1', 'accept-language': 'ru', countrycodes: 'ru' });
      const response = await fetch('https://nominatim.openstreetmap.org/search?' + params);
      const first = (response.ok ? await response.json() : [])[0];
      if (!first?.lat || !first.lon) throw new Error('not found');
      const lat = Number(first.lat), lng = Number(first.lon), address = first.address || {};
      const street = String(address.road || address.pedestrian || address.residential || '').trim(), house = String(address.house_number || '').trim();
      state.map.flyTo({ center: [lng, lat], zoom: 17, pitch: 12, bearing: 0, essential: true });
      await handleClick(lng, lat, { street, house });
    } catch (_) { setInfo('Поиск', 'Адрес не найден. Уточните запрос.', false); }
  }

  function updateUserLocation(position) {
    const lat = Number(position.coords.latitude), lng = Number(position.coords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (state.userMarker) state.userMarker.setLngLat([lng, lat]);
    else state.userMarker = new maplibregl.Marker({ element: markerElement('./assets/user-location.png', 'user-location-marker', 24, 24), anchor: 'center' }).setLngLat([lng, lat]).addTo(state.map);
    if (!state.userCentered) { state.map.flyTo({ center: [lng, lat], zoom: 18, pitch: 12, bearing: 0, essential: true }); state.userCentered = true; }
  }

  async function loadData() {
    let data = window.HYPERLOCAL_DATA;
    if (!data) { const response = await fetch('./data/buildings.json', { cache: 'no-cache' }); if (!response.ok) throw new Error('data'); data = await response.json(); }
    const streets = data.streets || [];
    for (const row of data.records || []) {
      const [streetIndex, house, structure, corpus, ownership, address, helpText, updatedAt, photoUrl, photoCrop] = row;
      state.records.set([streets[streetIndex] || '', house, structure, corpus, ownership].join('\u001f'), { address, help_text: helpText || '', updated_at: updatedAt || '', photo_url: photoUrl || '', photo_crop: photoCrop || '' });
    }
  }

  function start() {
    if (!window.maplibregl) return setInfo('Карта', 'Не удалось загрузить библиотеку карты.', false);
    state.map = new maplibregl.Map({ container: 'map', style: STYLE, center: MOSCOW, zoom: 16, pitch: 12, bearing: 0, maxZoom: 20, attributionControl: false });
    state.map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
    state.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenFreeMap · © OpenStreetMap contributors' }), 'bottom-left');
    state.map.on('click', (event) => handleClick(event.lngLat.lng, event.lngLat.lat));
    state.map.on('load', async () => { try { await loadData(); } catch (_) {} if (navigator.geolocation) navigator.geolocation.watchPosition(updateUserLocation, () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }); });
    state.map.on('error', () => { if (!state.map.isStyleLoaded()) setInfo('Карта', 'Не удалось загрузить векторную карту OpenFreeMap.', false); });
    $('search-form').addEventListener('submit', search);
    $('info-close').addEventListener('click', () => { $('info-card').classList.add('is-hidden'); $('info-card').setAttribute('aria-hidden', 'true'); });
  }

  start();
}());
