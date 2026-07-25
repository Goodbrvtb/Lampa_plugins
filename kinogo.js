/**
 * Kinogo Plugin for Lampa
 * 
 * Добавляет kinogo.ec как источник для поиска и просмотра фильмов и сериалов.
 * 
 * Установка:
 * Настройки → Расширения → Добавить плагин → указать URL плагина
 * 
 * Архитектура kinogo.ec:
 * - DLE (DataLife Engine) сайт с Cloudflare защитой
 * - Поиск: https://kinogo.ec/index.php?do=search&subaction=search&story=QUERY
 * - Видео плеер загружается через iframe с data-src на cinemar.cc
 * - Для сериалов — выбор сезона/серии через data-id
 * 
 * @version 0.1.0
 */

(function () {
    'use strict';

    var network = new Lampa.Reguest();
    var BASE_URL = 'https://kinogo.ec';
    var SEARCH_URL = BASE_URL + '/index.php?do=search&subaction=search&story=';

    // ============================================================
    // Регистрация плагина
    // ============================================================
    var manifest = {
        type: 'balancer',
        version: '0.1.0',
        name: 'Kinogo',
        description: 'Поиск и просмотр фильмов с kinogo.ec',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
        component: 'kinogo'
    };

    function startPlugin() {
        Lampa.Manifest.plugins = manifest;

        // ============================================================
        // Настройки плагина
        // ============================================================
        Lampa.SettingsApi.addParam({
            component: 'kinogo',
            param: {
                type: 'title'
            },
            field: {
                name: 'Kinogo.ec'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'kinogo',
            param: {
                type: 'select',
                name: 'kinogo_player',
                'default': '0'
            },
            field: {
                name: 'Плеер по умолчанию',
                description: 'Выбор плеера для просмотра'
            },
            variants: [
                { id: '0', name: 'Основной (Смотреть онлайн)' },
                { id: '1', name: 'Плеер 1' },
                { id: '3', name: 'Плеер 3' }
            ]
        });

        // ============================================================
        // Компонент поиска/категории (категория в меню)
        // ============================================================
        function component(object) {
            var comp = new Lampa.InteractionCategory(object);

            comp.create = function () {
                var self = this;
                self.activity.loader(true);

                // Загружаем популярные/новинки
                network.silent(BASE_URL + '/v1new/', function (html) {
                    var items = parseCatalogPage(html);
                    if (items.length > 0) {
                        self.build(items);
                    } else {
                        self.empty();
                    }
                    self.activity.loader(false);
                }, function () {
                    self.empty();
                    self.activity.loader(false);
                });
            };

            comp.nextPageReuest = function (object, resolve, reject) {
                resolve([]);
            };

            return comp;
        }

        // ============================================================
        // Парсинг HTML страницы каталога
        // ============================================================
        function parseCatalogPage(html) {
            var items = [];
            try {
                // Используем DOMParser если доступен
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');

                // Ищем элементы фильмов на странице
                var movieElements = doc.querySelectorAll('.sect-story, .story, [class*="short-story"], article');
                
                movieElements.forEach(function (el) {
                    var link = el.querySelector('a[href*="kinogo.ec/"]');
                    if (!link) link = el.querySelector('a[href*=".html"]');
                    
                    if (link) {
                        var href = link.getAttribute('href');
                        var title = link.textContent.trim();
                        var img = el.querySelector('img');
                        var imgSrc = img ? img.getAttribute('src') || img.getAttribute('data-src') : '';

                        // Парсим рейтинг
                        var ratingEl = el.querySelector('[class*="rating"], [class*="vote"]');
                        var rating = ratingEl ? ratingEl.textContent.trim() : '';

                        // Парсим метаданные
                        var yearEl = el.querySelector('a[href*="year-teg"]');
                        var year = yearEl ? yearEl.textContent.trim() : '';

                        if (title && href) {
                            items.push({
                                id: Lampa.Utils.hash(href),
                                title: title.replace(/\s*\(\d{4}\)/, '').trim(),
                                year: year,
                                url: href.startsWith('http') ? href : BASE_URL + href,
                                poster: imgSrc || '',
                                rating: rating,
                                source: 'kinogo'
                            });
                        }
                    }
                });
            } catch (e) {
                console.log('Kinogo', 'Parse error:', e);
                // Fallback: regex парсинг
                var regex = /<a[^>]*href="([^"]*kinogo\.ec\/[^"]*\.html)"[^>]*>([^<]+)<\/a>/gi;
                var match;
                while ((match = regex.exec(html)) !== null) {
                    if (match[1] && match[2]) {
                        var exists = items.some(function (item) { return item.url === match[1]; });
                        if (!exists) {
                            items.push({
                                id: Lampa.Utils.hash(match[1]),
                                title: match[2].trim().replace(/\s*\(\d{4}\)/, '').trim(),
                                url: match[1].startsWith('http') ? match[1] : BASE_URL + match[1],
                                source: 'kinogo'
                            });
                        }
                    }
                }
            }
            return items;
        }

        // ============================================================
        // Парсинг страницы фильма (извлечение iframe data-src)
        // ============================================================
        function parseMoviePage(html, playerIndex) {
            playerIndex = playerIndex || 0;
            
            // Ищем все iframe с data-src
            var iframeRegex = /<iframe[^>]*data-src="([^"]*cinemar\.cc[^"]*)"/gi;
            var iframes = [];
            var match;
            while ((match = iframeRegex.exec(html)) !== null) {
                iframes.push(match[1]);
            }

            // Если указан конкретный плеер, берем его
            var selectedPlayer = Lampa.Storage.get('kinogo_player', '0');
            var idx = parseInt(selectedPlayer) || 0;
            
            // Плеер 3 вынесен в отдельную позицию
            if (idx === 3) idx = 2;
            
            var iframeSrc = iframes[idx] || iframes[0];

            // Извлекаем ID видео
            var videoId = '';
            var idMatch = iframeSrc.match(/\/embed\/(\d+)/);
            if (idMatch) videoId = idMatch[1];

            return {
                iframeSrc: iframeSrc,
                videoId: videoId,
                iframes: iframes
            };
        }

        // ============================================================
        // Поиск (вызывается из Lampa при поиске)
        // ============================================================
        function search(query, oncomplete, onerror) {
            console.log('Kinogo', 'Searching for:', query);
            
            network.silent(SEARCH_URL + encodeURIComponent(query), function (html) {
                var items = parseSearchResults(html);
                oncomplete({
                    secuses: true,
                    page: 1,
                    results: items
                });
            }, function (err) {
                console.log('Kinogo', 'Search error:', err);
                oncomplete({
                    secuses: true,
                    page: 1,
                    results: []
                });
            });
        }

        // ============================================================
        // Парсинг результатов поиска
        // ============================================================
        function parseSearchResults(html) {
            var items = [];
            try {
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');

                // Ищем результаты поиска
                var resultElements = doc.querySelectorAll('.story, .short-story, article, [class*="story"]');
                
                resultElements.forEach(function (el) {
                    var link = el.querySelector('a[href*=".html"]');
                    if (!link) return;

                    var href = link.getAttribute('href');
                    var title = link.textContent.trim();
                    var img = el.querySelector('img');
                    var imgSrc = img ? img.getAttribute('src') || img.getAttribute('data-src') : '';

                    // Извлекаем год
                    var yearMatch = title.match(/\((\d{4})\)/);
                    var year = yearMatch ? yearMatch[1] : '';

                    // Извлекаем рейтинг
                    var ratingEl = el.querySelector('[class*="rating"], [class*="vote"]');
                    var rating = ratingEl ? ratingEl.textContent.trim() : '';

                    // Извлекаем тип (фильм/сериал)
                    var type = 'movie';
                    if (title.toLowerCase().indexOf('сезон') >= 0 || 
                        title.toLowerCase().indexOf('serial') >= 0 ||
                        title.toLowerCase().indexOf('season') >= 0) {
                        type = 'tv';
                    }

                    if (title && href && href.indexOf('.html') > 0) {
                        items.push({
                            id: Lampa.Utils.hash(href),
                            title: title.replace(/\s*\(\d{4}\)/, '').trim(),
                            year: year,
                            url: href.startsWith('http') ? href : BASE_URL + href,
                            poster: imgSrc || '',
                            rating: rating,
                            type: type,
                            source: 'kinogo'
                        });
                    }
                });
            } catch (e) {
                console.log('Kinogo', 'Parse search error:', e);
            }
            return items;
        }

        // ============================================================
        // Получение ссылки на видео по URL страницы
        // ============================================================
        function getVideo(url, oncomplete) {
            console.log('Kinogo', 'Getting video from:', url);
            
            network.silent(url, function (html) {
                var player = parseMoviePage(html);
                
                if (player.iframeSrc) {
                    console.log('Kinogo', 'Found iframe:', player.iframeSrc);
                    oncomplete({
                        secuses: true,
                        url: player.iframeSrc,
                        player: 'iframe',
                        title: 'Kinogo'
                    });
                } else {
                    console.log('Kinogo', 'No iframe found on page');
                    oncomplete({
                        secuses: true,
                        url: url,
                        player: 'redirect',
                        title: 'Kinogo'
                    });
                }
            }, function () {
                oncomplete({
                    secuses: true,
                    url: url,
                    player: 'redirect',
                    title: 'Kinogo'
                });
            });
        }

        // ============================================================
        // Регистрация балансера (источника)
        // ============================================================
        Lampa.Balancer.add({
            name: 'Kinogo',
            search: function (query, oncomplete, onerror) {
                search(query, oncomplete, onerror);
            },
            getLink: function (object, oncomplete) {
                var url = object.url;
                if (!url && object.id) {
                    url = BASE_URL + '/?newsid=' + object.id;
                }
                if (url) {
                    getVideo(url, oncomplete);
                } else {
                    oncomplete({ secuses: false });
                }
            }
        });

        // ============================================================
        // Обработка клика по результату поиска
        // ============================================================
        Lampa.Listener.follow('full', function (event) {
            if (event.type === 'complite' && event.data && event.data.movie) {
                var movie = event.data.movie;
                if (movie.source === 'kinogo' && movie.url) {
                    // Добавляем кнопку для открытия на Kinogo
                    // (Плагин уже зарегистрирован как балансер)
                }
            }
        });

        console.log('Kinogo', 'Plugin started');
    }

    // ============================================================
    // Запуск
    // ============================================================
    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                startPlugin();
            }
        });
    }
})();
