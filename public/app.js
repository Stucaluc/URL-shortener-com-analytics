(() => {
  'use strict';

  const API = '/api/v1';
  const KEY_STORAGE = 'shortener.apiKey';
  const $ = (selector) => document.querySelector(selector);

  const state = { selectedCode: null, charts: {} };

  // Tema claro/escuro conforme o sistema (Bootstrap 5.3 usa data-bs-theme)
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => document.documentElement.setAttribute('data-bs-theme', media.matches ? 'dark' : 'light');
  applyTheme();
  media.addEventListener('change', () => {
    applyTheme();
    if (state.selectedCode) loadStats();
  });

  // ---------- utilidades ----------

  /** Cria elementos sem usar innerHTML (todo texto entra via textContent). */
  function h(tag, props = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
      if (name === 'class') element.className = value;
      else if (name === 'text') element.textContent = value;
      else if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
      else element.setAttribute(name, value);
    }
    for (const child of children) element.append(child);
    return element;
  }

  const storage = {
    get() {
      try {
        return sessionStorage.getItem(KEY_STORAGE) || '';
      } catch {
        return '';
      }
    },
    set(value) {
      try {
        if (value) sessionStorage.setItem(KEY_STORAGE, value);
        else sessionStorage.removeItem(KEY_STORAGE);
      } catch {
        /* armazenamento indisponível: a chave vale apenas para esta página */
      }
    },
  };

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    const key = storage.get();
    if (key) headers['x-api-key'] = key;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;

    let data = null;
    try {
      data = await response.json();
    } catch {
      /* resposta sem corpo JSON */
    }
    if (!response.ok) {
      throw new ApiError(response.status, (data && data.message) || `Erro ${response.status}`);
    }
    return data;
  }

  function showAlert(message, type = 'danger') {
    const box = $('#alert');
    box.className = `alert alert-${type}`;
    box.textContent = message;
  }

  function clearAlert() {
    const box = $('#alert');
    box.className = 'alert d-none';
    box.textContent = '';
  }

  function handleError(error) {
    if (error instanceof ApiError && error.status === 401) {
      showAlert('API key ausente ou inválida. Informe a chave no campo do topo da página.');
    } else {
      showAlert(error.message || 'Erro inesperado');
    }
  }

  const formatDate = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const formatNumber = (value) => Number(value).toLocaleString('pt-BR');

  // ---------- lista de links ----------

  async function loadLinks() {
    try {
      const { items } = await api('/links?limit=50');
      clearAlert();
      renderLinks(items);
    } catch (error) {
      renderLinks([]);
      handleError(error);
    }
  }

  function renderLinks(items) {
    const body = $('#links-body');
    body.replaceChildren();
    $('#links-empty').classList.toggle('d-none', items.length > 0);

    for (const link of items) {
      const row = h(
        'tr',
        { class: `link-row${link.code === state.selectedCode ? ' active' : ''}`, tabindex: '0' },
        h('td', {}, h('code', { text: link.shortUrl })),
        h('td', { class: 'target-cell', title: link.targetUrl, text: link.targetUrl }),
        h('td', { class: 'text-end', text: formatNumber(link.clickCount) }),
        h('td', { text: formatDate(link.createdAt) }),
        h(
          'td',
          { class: 'text-end text-nowrap' },
          h('button', {
            class: 'btn btn-sm btn-outline-secondary me-1',
            type: 'button',
            text: 'Copiar',
            onclick: (event) => {
              event.stopPropagation();
              copy(link.shortUrl, event.currentTarget);
            },
          }),
          h('button', {
            class: 'btn btn-sm btn-outline-danger',
            type: 'button',
            text: 'Excluir',
            onclick: (event) => {
              event.stopPropagation();
              removeLink(link.code);
            },
          }),
        ),
      );
      row.addEventListener('click', () => selectLink(link.code));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') selectLink(link.code);
      });
      body.append(row);
    }
  }

  async function copy(text, button) {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copiado!';
    } catch {
      button.textContent = 'Falhou';
    }
    setTimeout(() => {
      button.textContent = original;
    }, 1500);
  }

  async function removeLink(code) {
    if (!window.confirm(`Excluir o link "${code}" e todo o seu histórico de cliques?`)) return;
    try {
      await api(`/links/${encodeURIComponent(code)}`, { method: 'DELETE' });
      if (state.selectedCode === code) {
        state.selectedCode = null;
        $('#stats').classList.add('d-none');
      }
      await loadLinks();
    } catch (error) {
      handleError(error);
    }
  }

  // ---------- criação ----------

  $('#create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = { url: form.url.value.trim() };
    if (form.alias.value.trim()) payload.alias = form.alias.value.trim();
    if (form.expires.value) payload.expiresAt = new Date(form.expires.value).toISOString();

    try {
      const link = await api('/links', { method: 'POST', body: payload });
      form.reset();
      showAlert(`Link criado: ${link.shortUrl}`, 'success');
      state.selectedCode = link.code;
      await loadLinks();
      await loadStats();
    } catch (error) {
      handleError(error);
    }
  });

  // ---------- estatísticas ----------

  function selectLink(code) {
    state.selectedCode = code;
    document.querySelectorAll('.link-row').forEach((row) => {
      row.classList.toggle('active', row.querySelector('code').textContent.endsWith(`/${code}`));
    });
    loadStats();
  }

  async function loadStats() {
    if (!state.selectedCode) return;
    const days = $('#days').value;
    try {
      const stats = await api(`/links/${encodeURIComponent(state.selectedCode)}/stats?days=${days}`);
      renderStats(stats);
    } catch (error) {
      handleError(error);
    }
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function renderChart(key, canvasId, config) {
    if (state.charts[key]) state.charts[key].destroy();
    state.charts[key] = new window.Chart($(canvasId), config);
  }

  function renderStats(stats) {
    $('#stats').classList.remove('d-none');
    $('#stats-title').textContent = `Estatísticas · /${stats.code}`;
    $('#kpi-total').textContent = formatNumber(stats.totalClicks);
    $('#kpi-unique').textContent = formatNumber(stats.uniqueVisitors);

    const textColor = cssVar('--bs-secondary-color');
    const gridColor = cssVar('--bs-border-color');
    const primary = cssVar('--bs-primary');

    renderChart('daily', '#chart-daily', {
      type: 'line',
      data: {
        labels: stats.clicksByDay.map((day) => day.date.slice(5)),
        datasets: [
          {
            label: 'Cliques',
            data: stats.clicksByDay.map((day) => day.clicks),
            borderColor: primary,
            backgroundColor: primary,
            tension: 0.25,
            pointRadius: stats.clicksByDay.length > 60 ? 0 : 3,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
          y: { beginAtZero: true, ticks: { color: textColor, precision: 0 }, grid: { color: gridColor } },
        },
      },
    });

    const palette = [primary, cssVar('--bs-success'), cssVar('--bs-warning'), cssVar('--bs-info'), cssVar('--bs-danger')];
    renderChart('devices', '#chart-devices', {
      type: 'doughnut',
      data: {
        labels: stats.devices.map((item) => item.label),
        datasets: [
          {
            data: stats.devices.map((item) => item.clicks),
            backgroundColor: stats.devices.map((_, index) => palette[index % palette.length]),
            borderColor: cssVar('--bs-body-bg'),
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: textColor } } },
      },
    });

    renderBars('#list-referrers', stats.topReferrers);
    renderBars('#list-browsers', stats.browsers);
    renderBars('#list-os', stats.operatingSystems);
    renderBars('#list-countries', stats.countries);
  }

  function renderBars(selector, items) {
    const container = $(selector);
    container.replaceChildren();
    if (items.length === 0) {
      container.append(h('p', { class: 'text-body-secondary small mb-0', text: 'Sem dados no período.' }));
      return;
    }
    const max = Math.max(...items.map((item) => item.clicks));
    for (const item of items) {
      const fill = h('div', { class: 'progress-bar' });
      fill.style.width = `${(item.clicks / max) * 100}%`;
      container.append(
        h(
          'div',
          { class: 'mb-2' },
          h(
            'div',
            { class: 'bar-label' },
            h('span', { title: item.label, text: item.label }),
            h('span', { class: 'text-body-secondary', text: formatNumber(item.clicks) }),
          ),
          h('div', { class: 'progress bar-track', role: 'presentation' }, fill),
        ),
      );
    }
  }

  // ---------- inicialização ----------

  $('#days').addEventListener('change', loadStats);
  $('#refresh').addEventListener('click', loadLinks);
  $('#key-form').addEventListener('submit', (event) => {
    event.preventDefault();
    storage.set($('#api-key').value.trim());
    loadLinks();
  });

  if (storage.get()) $('#api-key').value = storage.get();
  loadLinks();
})();
