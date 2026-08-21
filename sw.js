// Service Worker for Fantasy Football Command Center
// Enables offline functionality and PWA features

const CACHE_NAME = 'fantasy-football-v3';

// App shell. Every entry is verified to exist in the repo - a missing file would
// make cache.addAll() reject and abort the whole install, which is what silently
// broke offline support in v1.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './css/features/team-manager.css',
  './css/features/waiver-wire.css',
  './css/features/analytics.css',
  './css/features/trade-analyzer.css',
  './css/features/playoff-simulator.css',
  './css/features/weather.css',
  './css/features/predictions.css',
  './css/core/variables.css',
  './css/core/reset.css',
  './css/core/base.css',
  './css/core/layout.css',
  './css/components/buttons.css',
  './css/components/cards.css',
  './css/components/forms.css',
  './css/components/navigation.css',
  './css/components/modals.css',
  './css/components/notifications.css',
  './css/features/dashboard.css',
  './css/features/configuration.css',
  './css/features/draft-tracker.css',
  './css/features/learning-academy.css',
  './css/features/team-management.css',
  './css/features/ai-insights.css',
  './css/features/streak-analysis.css',
  './css/utilities/spacing.css',
  './css/utilities/typography.css',
  './css/utilities/responsive.css',
  './css/utilities/accessibility.css',
  './css/utilities/print.css',
  './js/core/config-manager.js',
  './js/core/navigation-manager.js',
  './js/core/learning-manager.js',
  './js/core/event-manager.js',
  './js/features/pick-advisor.js',
  './js/features/draft-tracker.js',
  './js/features/streak-analyzer.js',
  './js/features/team-manager.js',
  './js/features/waiver-wire.js',
  './js/features/performance-analytics.js',
  './js/features/trend-analyzer.js',
  './js/features/league-analyzer.js',
  './js/features/trade-analyzer.js',
  './js/features/playoff-simulator.js',
  './js/features/weather-analyzer.js',
  './js/features/predictive-analytics.js',
  './js/utils/sleeper-api.js',
  './js/app.js',
  './icons/icon-96.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
];

// Requests we must never serve from cache: live fantasy data and weather forecasts.
function isApiRequest(url) {
  return url.origin !== self.location.origin;
}

// Install - precache the app shell. Each URL is added individually so one bad
// entry degrades offline coverage instead of failing the entire installation.
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(
        PRECACHE_URLS.map(function(url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function(err) {
            console.warn('ServiceWorker: failed to precache', url, err);
          });
        })
      );
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Fetch - network-first for navigations so a deploy is picked up immediately,
// stale-while-revalidate for static assets, and straight to the network for APIs.
self.addEventListener('fetch', function(event) {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isApiRequest(url)) return; // Sleeper / Open-Meteo always go to the network

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function(response) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(request, copy); });
          return response;
        })
        .catch(function() {
          return caches.match(request).then(function(cached) {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Application code is network-first. These filenames carry no content hash, so
  // serving a cached copy first means a deploy takes an extra load to reach the
  // user - and running a stale bundle silently is worse than a slower start.
  const isAppCode = /\.(?:js|css)$/i.test(url.pathname);

  if (isAppCode) {
    event.respondWith(
      fetch(request)
        .then(function(response) {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(request, copy); });
          }
          return response;
        })
        .catch(function() {
          return caches.match(request);
        })
    );
    return;
  }

  // Everything else (icons, manifest) is stale-while-revalidate.
  event.respondWith(
    caches.match(request).then(function(cached) {
      const network = fetch(request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function() {
        return cached;
      });
      return cached || network;
    })
  );
});

// Activate - drop caches from previous versions and take control immediately.
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Background sync for when user comes back online
self.addEventListener('sync', function(event) {
  if (event.tag === 'background-sync') {
    console.log('Background sync triggered');
  }
});

// Handle app shortcuts
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.openWindow(urlToOpen)
  );
});

// Handle push notifications (future enhancement)
self.addEventListener('push', function(event) {
  const options = {
    body: event.data ? event.data.text() : 'New fantasy update available!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      { action: 'explore', title: 'View Update' },
      { action: 'close', title: 'Close' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Fantasy Football Update', options)
  );
});

// Handle message from main thread
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Periodic background sync (experimental)
self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'content-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  console.log('Periodic background sync executed');
}
