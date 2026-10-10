/**
 * =========================================================================
 * OPERAÇÃO APOGEU | CÂMARA DOS DEPUTADOS (CARGO 4: ARQUIVOLOGIA)
 * PWA SERVICE WORKER — FILIPE OLIVEIRA SANTOS
 * =========================================================================
 * Estratégia de Alto Rendimento:
 *  - Navegação/HTML: Network-First com Fallback Offline (Garante atualizações sem prender no cache)
 *  - Imagens/Ativos Locais: Stale-While-Revalidate (Velocidade instantânea com atualização silenciosa)
 *  - Fontes Externas: Cache-First com isolamento
 *  - Blindagem: Tolerância contra arquivos ausentes (evita quebra na instalação)
 * =========================================================================
 */

const VERSION = 'v4.0.0';
const CACHE_PREFIX = 'apogeu-filipe';
const CACHES = {
  shell: `${CACHE_PREFIX}-shell-${VERSION}`,
  assets: `${CACHE_PREFIX}-assets-${VERSION}`,
  fonts: `${CACHE_PREFIX}-fonts-${VERSION}`
};

// 1. Núcleo Estrutural Inegociável (App Shell)
const CORE_SHELL = [
  './',
  './index.html',
  './manifest.json'
];

// 2. Imagens Locais e Identidade Visual (com tolerância a falhas)
const LOCAL_ASSETS = [
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/logo-entalpia.png',
  './assets/banner.jpg',
  './assets/watermark.jpg',
  // Rotas alternativas de contingência caso os arquivos fiquem na raiz ou em asset/
  './assets/logo-entalpia.png',
  './assets/banner.jpg',
  './assets/watermark.jpg'
];

// 3. Tipografias Oficiais (Google Fonts)
const EXTERNAL_FONTS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700;900&display=swap'
];

// =========================================================================
// CICLO 1: INSTALAÇÃO (Precache resiliente)
// =========================================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // 1.1 Cache obrigatório do Shell
      const shellCache = await caches.open(CACHES.shell);
      await shellCache.addAll(CORE_SHELL);

      // 1.2 Cache tolerante de ativos visuais (não interrompe o fluxo se faltar imagem)
      const assetCache = await caches.open(CACHES.assets);
      await Promise.allSettled(
        LOCAL_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response && response.ok) {
              await assetCache.put(url, response);
            }
          } catch (_) {
            // Silencia arquivos opcionais ainda não enviados
          }
        })
      );

      // 1.3 Cache das fontes externas
      const fontCache = await caches.open(CACHES.fonts);
      await Promise.allSettled(
        EXTERNAL_FONTS.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response && response.ok) {
              await fontCache.put(url, response);
            }
          } catch (_) {
            // Ignora se estiver sem rede durante instalação
          }
        })
      );

      // Assume o controle imediatamente
      return self.skipWaiting();
    })()
  );
});

// =========================================================================
// CICLO 2: ATIVAÇÃO (Purga cirúrgica de caches obsoletos)
// =========================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const activeCacheKeys = Object.values(CACHES);
      const existingKeys = await caches.keys();

      await Promise.all(
        existingKeys.map(async (key) => {
          if (!activeCacheKeys.includes(key)) {
            await caches.delete(key);
          }
        })
      );

      // Controla as páginas abertas sem precisar de recarregamento
      return self.clients.claim();
    })()
  );
});

// =========================================================================
// CICLO 3: INTERCEPTAÇÃO DE REQUISIÇÕES (Fetch Routing Inteligente)
// =========================================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora chamadas não HTTP/HTTPS (extensões do navegador, web sockets, etc.)
  if (!url.protocol.startsWith('http')) return;

  // A. ESTRATÉGIA PARA NAVEGAÇÃO / HTML (Network-First com Fallback Offline)
  // Impede que modificações feitas no código do index.html fiquem presas em cache antigo
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            const shellCache = await caches.open(CACHES.shell);
            shellCache.put(request, networkResponse.clone());
            return networkResponse;
          }
        } catch (_) {
          // Falha na rede: recupera do cache ou entrega o index base
        }

        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;

        return caches.match('./index.html');
      })()
    );
    return;
  }

  // B. ESTRATÉGIA PARA FONTES DO GOOGLE (Cache-First)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      (async () => {
        const fontCache = await caches.open(CACHES.fonts);
        const cached = await fontCache.match(request);
        if (cached) return cached;

        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            fontCache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (_) {
          return cached;
        }
      })()
    );
    return;
  }

  // C. ESTRATÉGIA PARA IMAGENS E MÍDIA LOCAL (Stale-While-Revalidate)
  // Carrega imediatamente do disco (velocidade de app nativo) e atualiza em segundo plano
  if (request.destination === 'image' || url.pathname.includes('/assets/')) {
    event.respondWith(
      (async () => {
        const assetCache = await caches.open(CACHES.assets);
        const cached = await assetCache.match(request);

        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              assetCache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        return cached || (await networkFetch);
      })()
    );
    return;
  }

  // D. DEMAIS RECURSOS (Stale-While-Revalidate Padrão)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHES.shell);
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// =========================================================================
// CICLO 4: CONTROLE DINÂMICO VIA MENSAGEM
// =========================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});