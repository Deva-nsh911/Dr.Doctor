const CACHE_NAME = "dr-doctor-v1";

const APP_FILES = [
    "/",
    "/patient.html",
    "/patient-details.html",
    "/language.html",
    "/patient-mode.html",
    "/text-interview.html",
    "/patient-report.html",
    "/style.css"
];

self.addEventListener("install", event => {

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(APP_FILES);
            })
    );

    self.skipWaiting();
});


self.addEventListener("activate", event => {

    event.waitUntil(

        caches.keys().then(keys => {

            return Promise.all(

                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))

            );

        })

    );

    self.clients.claim();
});


self.addEventListener("fetch", event => {

    event.respondWith(

        fetch(event.request)
            .catch(() => {

                return caches.match(event.request);

            })

    );

});